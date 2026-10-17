"""独立的数据校验 Agent，通过确定性工具执行规则校验。"""

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass

from ..prompts import PromptLoader
from ..tools.validation import ValidationToolOutput, validate_data
from .contracts.common import AgentContext, Notice
from .contracts.inputs import SchedulingCase, ValidationInput
from .contracts.results import ValidationResult
from .result_validation import AgentContractError, validate_request, validate_result

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ValidationRun:
    """保存本次校验使用的完整请求和新增证据，供后续编排使用。"""

    request: ValidationInput
    result: ValidationResult
    prompt_sha256: str


class ValidationAgent:
    """加载角色定义，调用规则工具，整理并校验报告。

    不调用大模型、发布工具、持久化组件或其他 Agent。
    业务校验是否通过由确定性规则决定，不交给模型判断。
    """

    def __init__(
        self,
        tool: Callable[[SchedulingCase, AgentContext], ValidationToolOutput] = validate_data,
    ) -> None:
        self._tool = tool

    def run(
        self,
        request: ValidationInput,
        *,
        expected_context: AgentContext | None = None,
    ) -> ValidationRun:
        prompt = PromptLoader().load("validation")
        checked = validate_request(request.model_dump_json(), prompt)
        if expected_context is not None and checked.context != expected_context:
            raise AgentContractError("STALE_CONTEXT", "请求版本已过期，请重新读取当前快照。")

        original = checked
        try:
            output = self._tool(
                checked.case_data.model_copy(deep=True), checked.context.model_copy(deep=True)
            )
            case_evidence = [
                output.evidence_catalog[ref]
                for ref in output.summary_refs
                if ref in output.evidence_catalog and output.evidence_catalog[ref].kind == "case"
            ]
            if len(case_evidence) != 1 or case_evidence[0].content != checked.case_data.model_dump(
                mode="json"
            ):
                raise AgentContractError("TOOL_INPUT_MISMATCH", "工具校验的快照与本次输入不一致。")
            catalog = dict(checked.evidence_catalog)
            for ref, evidence in output.evidence_catalog.items():
                if ref in catalog and catalog[ref] != evidence:
                    raise AgentContractError("EVIDENCE_COLLISION", "工具证据引用与现有记录冲突。")
                catalog[ref] = evidence
            # 重新解析并校验：model_copy(update=...) 本身不会校验更新后的值。
            prepared = checked.model_dump(mode="json")
            prepared["evidence_catalog"] = {
                k: v.model_dump(mode="json") for k, v in catalog.items()
            }
            prepared["validation_tool_result"] = output.data.model_dump(mode="json")
            checked = validate_request(json.dumps(prepared), prompt)
            data = checked.validation_tool_result
            warnings = [
                Notice(
                    code=i.code,
                    message=i.message,
                    repair_hint=i.repair_hint,
                    evidence_refs=i.evidence_refs,
                )
                for i in data.issues
                if i.severity == "warning"
            ]
            errors = [
                Notice(
                    code=i.code,
                    message=i.message,
                    repair_hint=i.repair_hint,
                    evidence_refs=i.evidence_refs,
                )
                for i in data.issues
                if i.severity == "blocking"
            ]
            status = "blocked" if errors else "warning" if warnings else "success"
            result = ValidationResult(
                agent_name="validation",
                prompt_version=prompt.role_metadata.prompt_version,
                requirements_version=prompt.role_metadata.requirements_version,
                context=checked.context,
                status=status,
                data=data,
                evidence_refs=list(output.summary_refs),
                warnings=warnings,
                errors=errors,
            )
            result = validate_result(result.model_dump_json(), checked, prompt)
        except Exception as exc:
            # 原始工具异常可能包含业务数据或凭据，因此只记录异常类型。
            logger.warning("Validation tool execution failed: %s", type(exc).__name__)
            checked = original
            result = ValidationResult(
                agent_name="validation",
                prompt_version=prompt.role_metadata.prompt_version,
                requirements_version=prompt.role_metadata.requirements_version,
                context=checked.context,
                status="failed",
                data=None,
                evidence_refs=[],
                warnings=[],
                errors=[
                    Notice(
                        code="VALIDATION_TOOL_FAILED",
                        message="数据校验工具执行失败或结果无效。",
                        repair_hint="检查工具运行记录并重试，当前结果不能用于生成候选。",
                        evidence_refs=[],
                    )
                ],
            )
            result = validate_result(result.model_dump_json(), checked, prompt)
        return ValidationRun(checked, result, prompt.content_sha256)
