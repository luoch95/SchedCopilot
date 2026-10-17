"""独立的排产执行 Agent，调用规则工具生成候选，不发布计划。"""

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass

from ..prompts import PromptLoader
from ..tools.scheduling import SchedulingToolOutput, generate_schedule, verify_tool_output
from ..tools.scheduling_context import SchedulingBlocked, SchedulingSource, prepare_scheduling
from .contracts.common import AgentContext, Notice
from .contracts.inputs import SchedulingInput
from .contracts.results import SchedulingResult
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
        try:
            source = prepare_scheduling(checked)
            # 工具只接收独立副本，不能通过修改输入来影响后续结果复核。
            tool_source = prepare_scheduling(checked.model_copy(deep=True))
            output = self._tool(tool_source)
            verify_tool_output(source, output)
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
            # 日志不包含异常正文，避免泄露业务输入或凭据。
            logger.warning("排产工具执行失败：%s", type(exc).__name__)
            checked = original
            result = SchedulingResult(
                agent_name="scheduling",
                prompt_version=prompt.role_metadata.prompt_version,
                requirements_version=prompt.role_metadata.requirements_version,
                context=checked.context,
                status="failed",
                data=None,
                evidence_refs=[],
                warnings=[],
                errors=[
                    Notice(
                        code="SCHEDULING_TOOL_FAILED",
                        message="候选生成工具执行失败或结果无效。",
                        repair_hint="检查工具记录后重试，本次结果不能用于方案选择。",
                        evidence_refs=[],
                    )
                ],
            )
            result = validate_result(result.model_dump_json(), checked, prompt)
        return SchedulingRun(checked, result, prompt.content_sha256)
