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
from .result_validation import AgentContractError, validate_request, validate_result

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ExplanationRun:
    request: ExplanationInput
    result: ExplanationResult
    prompt_sha256: str


class ExplanationAgent:
    """首版使用可追溯模板；工具只接收副本，不拥有写入或发布权限。"""

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
        try:
            source = prepare_explanation(checked)
            data = self._tool(prepare_explanation(checked.model_copy(deep=True)))
            # 不能仅凭引用存在就允许工具编造语义；首版输出须与受控模板一致。
            if data != explain_results(source):
                raise ValueError("解释内容与已登记结构化事实不一致")
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
        return ExplanationRun(checked, result, prompt.content_sha256)
