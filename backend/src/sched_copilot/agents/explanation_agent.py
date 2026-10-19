"""独立解释 Agent：只组织已有结果，不生成计划或计算评价指标。"""

import logging
from collections.abc import Callable
from dataclasses import dataclass

from ..prompts import PromptLoader
from ..tools.explanation import explain_results
from ..tools.explanation_context import (
    ExplanationBlocked,
    ExplanationSource,
    prepare_explanation,
)
from .contracts.common import AgentContext, Notice
from .contracts.inputs import ExplanationInput
from .contracts.results import ExplanationData, ExplanationResult
from .quality import QualityFailure, checked_execute, finish_quality
from .result_validation import AgentContractError, validate_request, validate_result

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ExplanationRun:
    request: ExplanationInput
    result: ExplanationResult
    prompt_sha256: str


class ExplanationAgent:
    """首版使用可追溯模板；工具只接收副本，不拥有写入或发布权限。"""

    def run_insertion(self, result):
        from ..tools.insertion import explain_request

        return explain_request(result)

    def __init__(
        self, tool: Callable[[ExplanationSource], ExplanationData] = explain_results
    ) -> None:
        self._tool = tool

    def run(
        self, request: ExplanationInput, *, expected_context: AgentContext | None = None
    ) -> ExplanationRun:
        prompt = PromptLoader().load("explanation")
        checked = validate_request(request.model_dump_json(), prompt)
        if expected_context is not None and checked.context != expected_context:
            raise AgentContractError("STALE_CONTEXT", "请求版本已过期，请重新读取当前快照。")
        quality = None
        try:
            source = prepare_explanation(checked)

            def inspect(data):
                if data != explain_results(source):
                    raise ValueError("解释遗漏风险或与已登记事实不一致")

            data, quality = checked_execute(
                lambda: self._tool(prepare_explanation(checked.model_copy(deep=True))),
                inspect,
                lambda rejected, issues: explain_results(
                    prepare_explanation(checked.model_copy(deep=True))
                ),
                blocked=(ExplanationBlocked,),
                repair_label="使用受控模板重建事实、风险与行动建议",
                check_code="EXPLANATION_FACT_OR_COVERAGE_MISMATCH",
                check_message="解释与已有事实不一致，或遗漏风险与限制，需要从可信证据重建说明。",
            )
            refs = list(
                dict.fromkeys(
                    ref
                    for ref in (
                        checked.validation_result_ref,
                        checked.candidate_batch_ref,
                        checked.evaluation_result_ref,
                    )
                    if ref is not None
                )
            )
            warnings = [
                Notice(
                    code="EXPLANATION_PARTIAL",
                    message=text,
                    repair_hint="补充所缺证据后重新解释。",
                    evidence_refs=refs,
                )
                for text in data.limitations
            ]
            result = ExplanationResult(
                agent_name="explanation",
                context=checked.context,
                prompt_version=prompt.role_metadata.prompt_version,
                requirements_version=prompt.role_metadata.requirements_version,
                status="warning" if warnings else "success",
                data=data,
                evidence_refs=refs,
                warnings=warnings,
                errors=[],
            )
            result = validate_result(result.model_dump_json(), checked, prompt)
        except ExplanationBlocked as exc:
            quality = getattr(exc, "quality_report", None)
            result = ExplanationResult(
                agent_name="explanation",
                context=checked.context,
                prompt_version=prompt.role_metadata.prompt_version,
                requirements_version=prompt.role_metadata.requirements_version,
                status="blocked",
                data=None,
                evidence_refs=exc.notice.evidence_refs,
                warnings=[],
                errors=[exc.notice],
            )
            result = validate_result(result.model_dump_json(), checked, prompt)
        except Exception as exc:
            if isinstance(exc, QualityFailure):
                quality = exc.report
            logger.warning("解释工具执行失败：%s", type(exc).__name__)
            result = ExplanationResult(
                agent_name="explanation",
                context=checked.context,
                prompt_version=prompt.role_metadata.prompt_version,
                requirements_version=prompt.role_metadata.requirements_version,
                status="failed",
                data=None,
                evidence_refs=[],
                warnings=[],
                errors=[
                    Notice(
                        code="EXPLANATION_TOOL_FAILED",
                        message="解释工具执行失败或输出无效。",
                        repair_hint="检查上游证据与工具记录后重试。",
                        evidence_refs=[],
                    )
                ],
            )
            result = validate_result(result.model_dump_json(), checked, prompt)
        result = finish_quality(result, quality)
        result = validate_result(result.model_dump_json(), checked, prompt)
        return ExplanationRun(checked, result, prompt.content_sha256)
