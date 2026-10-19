"""独立的评估 Agent，调用规则工具生成评价，不发布计划。"""

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass

from ..prompts import PromptLoader
from ..tools.evaluation import (
    EvaluationBlocked,
    EvaluationSource,
    EvaluationToolOutput,
    evaluate_candidates,
    prepare_evaluation,
    verify_evaluation_output,
)
from .contracts.common import AgentContext, Notice
from .contracts.inputs import EvaluationInput
from .contracts.results import EvaluationResult
from .quality import QualityFailure, checked_execute, finish_quality, verify_evidence
from .result_validation import AgentContractError, validate_request, validate_result

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EvaluationRun:
    """保留已核验的输入、评价证据和报告，供未来编排器使用。"""

    request: EvaluationInput
    result: EvaluationResult
    prompt_sha256: str


class EvaluationAgent:
    """先检查已有候选，再调用评价工具；不调用模型或其他 Agent。"""

    def __init__(
        self, tool: Callable[[EvaluationSource], EvaluationToolOutput] = evaluate_candidates
    ):
        self._tool = tool

    def run(
        self, request: EvaluationInput, *, expected_context: AgentContext | None = None
    ) -> EvaluationRun:
        prompt = PromptLoader().load("evaluation")
        checked = validate_request(request.model_dump_json(), prompt)
        if expected_context is not None and checked.context != expected_context:
            raise AgentContractError("STALE_CONTEXT", "请求版本已过期，请重新读取当前快照。")
        original = checked
        quality = None
        try:
            source = prepare_evaluation(checked)

            def inspect(output):
                verify_evidence(output, original)
                verify_evaluation_output(source, output)

            output, quality = checked_execute(
                lambda: self._tool(prepare_evaluation(original.model_copy(deep=True))),
                inspect,
                lambda rejected, issues: evaluate_candidates(
                    prepare_evaluation(original.model_copy(deep=True))
                ),
                blocked=(EvaluationBlocked,),
                repair_label="独立重算指标并重建风险和缺失指标说明",
                check_code="EVALUATION_RECOMPUTE_MISMATCH",
                check_message="指标、差异或风险与独立重算结果不一致，需要重新计算并核对证据。",
            )
            catalog = dict(checked.evidence_catalog)
            for ref, evidence in output.evidence_catalog.items():
                if ref in catalog and catalog[ref] != evidence:
                    raise AgentContractError("EVIDENCE_COLLISION", "评价证据引用与现有记录冲突。")
                catalog[ref] = evidence
            prepared = checked.model_dump(mode="json")
            prepared["evidence_catalog"] = {
                k: v.model_dump(mode="json") for k, v in catalog.items()
            }
            prepared["evaluation_tool_result"] = output.data.model_dump(mode="json")
            checked = validate_request(json.dumps(prepared), prompt)
            warnings = list(output.warnings)
            result = EvaluationResult(
                agent_name="evaluation",
                prompt_version=prompt.role_metadata.prompt_version,
                requirements_version=prompt.role_metadata.requirements_version,
                context=checked.context,
                status="warning" if warnings else "success",
                data=checked.evaluation_tool_result,
                evidence_refs=list(output.summary_refs),
                warnings=warnings,
                errors=[],
            )
            result = validate_result(result.model_dump_json(), checked, prompt)
        except EvaluationBlocked as exc:
            quality = getattr(exc, "quality_report", None)
            checked = original
            result = EvaluationResult(
                agent_name="evaluation",
                prompt_version=prompt.role_metadata.prompt_version,
                requirements_version=prompt.role_metadata.requirements_version,
                context=checked.context,
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
            # 日志不包含异常正文，避免泄露业务输入或凭据。
            logger.warning("评估工具执行失败：%s", type(exc).__name__)
            checked = original
            result = EvaluationResult(
                agent_name="evaluation",
                prompt_version=prompt.role_metadata.prompt_version,
                requirements_version=prompt.role_metadata.requirements_version,
                context=checked.context,
                status="failed",
                data=None,
                evidence_refs=[],
                warnings=[],
                errors=[
                    Notice(
                        code="EVALUATION_TOOL_FAILED",
                        message="评价工具执行失败或结果无效。",
                        repair_hint="检查工具记录后重试，本次结果不能用于方案选择。",
                        evidence_refs=[],
                    )
                ],
            )
            result = validate_result(result.model_dump_json(), checked, prompt)
        result = finish_quality(result, quality)
        result = validate_result(result.model_dump_json(), checked, prompt)
        return EvaluationRun(checked, result, prompt.content_sha256)
