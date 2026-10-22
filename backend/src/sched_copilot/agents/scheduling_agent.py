"""独立的排产执行 Agent，调用规则工具生成候选，不发布计划。"""

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass

from ..prompts import PromptLoader
from ..tools.scheduling import SchedulingToolOutput, generate_schedule, verify_tool_output
from ..tools.scheduling_context import SchedulingBlocked, SchedulingSource, prepare_scheduling
from .contracts.common import AgentContext
from .contracts.inputs import SchedulingInput
from .contracts.results import SchedulingResult
from .quality import (
    QualityFailure,
    checked_execute,
    failure_notice,
    failure_status,
    finish_quality,
    verify_evidence,
)
from .result_validation import AgentContractError, validate_request, validate_result

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SchedulingRun:
    """保留已核验的输入、候选证据和报告，供未来编排器使用。"""

    request: SchedulingInput
    result: SchedulingResult
    prompt_sha256: str


class SchedulingAgent:
    """先检查校验报告，再调用工具；不调用模型或其他 Agent。"""

    def run_insertion(self, calculate, snapshot):
        from ..tools.insertion import schedule_request

        return schedule_request(calculate, snapshot)

    def __init__(
        self, tool: Callable[[SchedulingSource], SchedulingToolOutput] = generate_schedule
    ):
        self._tool = tool

    def run(
        self, request: SchedulingInput, *, expected_context: AgentContext | None = None
    ) -> SchedulingRun:
        prompt = PromptLoader().load("scheduling")
        checked = validate_request(request.model_dump_json(), prompt)
        if expected_context is not None and checked.context != expected_context:
            raise AgentContractError("STALE_CONTEXT", "请求版本已过期，请重新读取当前快照。")
        original = checked
        quality = None
        try:
            source = prepare_scheduling(checked)

            def inspect(output):
                verify_evidence(output, original)
                verify_tool_output(source, output)
                expected = generate_schedule(prepare_scheduling(original.model_copy(deep=True)))
                if output != expected:
                    raise ValueError("候选、策略、限制或风险披露与规则结果不一致")

            output, quality = checked_execute(
                lambda: self._tool(prepare_scheduling(original.model_copy(deep=True))),
                inspect,
                lambda rejected, issues: generate_schedule(
                    prepare_scheduling(original.model_copy(deep=True))
                ),
                blocked=(SchedulingBlocked,),
                repair_label="按原快照和允许策略重建候选及约束证据",
                check_code="SCHEDULING_CONSTRAINT_OR_EVIDENCE_INVALID",
                check_message="候选工序、硬约束、变更记录或风险说明不一致，需要重建候选。",
            )
            catalog = dict(checked.evidence_catalog)
            for ref, evidence in output.evidence_catalog.items():
                if ref in catalog and catalog[ref] != evidence:
                    raise AgentContractError("EVIDENCE_COLLISION", "候选证据引用与现有记录冲突。")
                catalog[ref] = evidence
            prepared = checked.model_dump(mode="json")
            prepared["evidence_catalog"] = {
                k: v.model_dump(mode="json") for k, v in catalog.items()
            }
            prepared["scheduling_tool_result"] = output.data.model_dump(mode="json")
            checked = validate_request(json.dumps(prepared), prompt)
            warnings = list(source.validation.warnings) + list(output.warnings)
            result = SchedulingResult(
                agent_name="scheduling",
                prompt_version=prompt.role_metadata.prompt_version,
                requirements_version=prompt.role_metadata.requirements_version,
                context=checked.context,
                status="warning" if warnings else "success",
                data=checked.scheduling_tool_result,
                evidence_refs=list(output.summary_refs),
                warnings=warnings,
                errors=[],
            )
            result = validate_result(result.model_dump_json(), checked, prompt)
        except SchedulingBlocked as exc:
            quality = getattr(exc, "quality_report", None)
            checked = original
            result = SchedulingResult(
                agent_name="scheduling",
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
            logger.warning("排产工具执行失败：%s", type(exc).__name__)
            checked = original
            result = SchedulingResult(
                agent_name="scheduling",
                prompt_version=prompt.role_metadata.prompt_version,
                requirements_version=prompt.role_metadata.requirements_version,
                context=checked.context,
                status=failure_status(exc),
                data=None,
                evidence_refs=[],
                warnings=[],
                errors=[failure_notice(exc, "scheduling", "SCHEDULING_TOOL_FAILED")],
            )
            result = validate_result(result.model_dump_json(), checked, prompt)
        result = finish_quality(result, quality)
        result = validate_result(result.model_dump_json(), checked, prompt)
        return SchedulingRun(checked, result, prompt.content_sha256)
