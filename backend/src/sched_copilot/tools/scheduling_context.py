"""核对排产请求来源，并建立确定性的设备资格清单。"""

import json
from dataclasses import dataclass

from pydantic import ValidationError

from ..agents.contracts.common import Notice
from ..agents.contracts.inputs import SchedulingCase, SchedulingInput
from ..agents.contracts.results import ValidationResult
from .validation import RULESET_VERSION, validate_data

SUPPORTED_STRATEGIES = frozenset({"wait-recovery", "allow-transfer"})


class SchedulingBlocked(ValueError):
    """业务前置条件不满足，与工具内部执行失败区分。"""

    def __init__(self, code: str, message: str, repair_hint: str, refs: list[str]) -> None:
        self.notice = Notice(
            code=code, message=message, repair_hint=repair_hint, evidence_refs=refs
        )
        super().__init__(message)


@dataclass(frozen=True)
class SchedulingSource:
    """保存经过核对的请求、原始快照与逐工序合格设备清单。"""

    request: SchedulingInput
    case: SchedulingCase
    validation: ValidationResult
    eligible_machine_ids: dict[str, frozenset[str]]


def prepare_scheduling(request: SchedulingInput) -> SchedulingSource:
    """先核验校验结论与快照一致，再允许调用候选生成工具。"""
    refs = [request.validation_result_ref, request.current_plan_ref]

    def block(code: str, message: str, hint: str) -> None:
        raise SchedulingBlocked(code, message, hint, refs)

    validation = ValidationResult.model_validate(
        request.evidence_catalog[request.validation_result_ref].content
    )
    if (
        validation.status not in {"success", "warning"}
        or validation.data is None
        or not validation.data.can_generate_candidates
        or validation.errors
        or not validation.evidence_refs
    ):
        block(
            "VALIDATION_BLOCKED",
            "当前校验结果未允许生成候选。",
            "先修复校验问题并重新执行数据校验。",
        )
    case_record = request.evidence_catalog[request.current_plan_ref]
    try:
        case = SchedulingCase.model_validate_json(json.dumps(case_record.content))
    except (ValidationError, TypeError):
        block(
            "CASE_SNAPSHOT_REQUIRED",
            "当前计划引用没有完整的排产案例快照。",
            "提供校验 Agent 使用的完整案例证据。",
        )
    snapshot_refs = [
        ref for ref in validation.evidence_refs if request.evidence_catalog[ref].kind == "case"
    ]
    if (
        case_record.kind != "case"
        or len(snapshot_refs) != 1
        or request.evidence_catalog[snapshot_refs[0]].content != case.model_dump(mode="json")
    ):
        block(
            "VALIDATION_SNAPSHOT_MISMATCH",
            "本次排产快照与上次通过校验的快照不同。",
            "重新执行当前快照的数据校验。",
        )
    rule_refs = [
        ref for ref in validation.evidence_refs if request.evidence_catalog[ref].kind == "rules"
    ]
    if len(rule_refs) != 1 or request.evidence_catalog[rule_refs[0]].content != {
        "ruleset_version": RULESET_VERSION
    }:
        block(
            "VALIDATION_RULESET_MISMATCH",
            "校验结果不属于当前规则版本。",
            "使用当前校验工具重新校验。",
        )
    # 只重跑确定性校验工具，不调用数据校验 Agent，也不依赖旧模型说明。
    fresh = validate_data(case, request.context).data
    if fresh != validation.data or not fresh.can_generate_candidates:
        block(
            "VALIDATION_RESULT_MISMATCH",
            "校验结论与当前数据重新检查的结果不一致。",
            "重新读取数据并执行校验。",
        )
    if validation.status == "success" and any(i.severity == "warning" for i in fresh.issues):
        block(
            "VALIDATION_RESULT_MISMATCH", "校验结果遗漏了工具警告。", "重新执行数据校验并保留警告。"
        )
    strategies = [item.strategy_id for item in request.allowed_strategies]
    if not strategies or len(set(strategies)) != len(strategies):
        block("INVALID_STRATEGIES", "排产策略列表为空或存在重复。", "提供不重复的已支持策略。")
    if set(strategies) - SUPPORTED_STRATEGIES:
        block(
            "STRATEGY_UNSUPPORTED",
            "当前仅支持等待恢复和合格设备转移。",
            "换型顺序等策略需等对应规则工具实现后使用。",
        )
    if any(item.parameters for item in request.allowed_strategies):
        block(
            "STRATEGY_PARAMETERS_UNSUPPORTED",
            "当前策略尚不支持附加参数。",
            "不要传入未实现的参数，需先扩展规则工具。",
        )
    if request.user_constraints:
        block(
            "USER_CONSTRAINTS_UNSUPPORTED",
            "当前工具不能可靠执行自由文本约束。",
            "使用明确的策略选择；其他约束需先结构化并实现。",
        )
    if request.wip_policy != case.wip_policy:
        block(
            "WIP_POLICY_MISMATCH",
            "本次在制品规则与已校验的快照不一致。",
            "更新案例规则后重新校验。",
        )
    mold_map = {item.mold_id: item for item in case.molds}
    failed = case.failures[0].machine_id
    eligibility = {
        op.operation_id: frozenset(
            machine.machine_id
            for machine in case.machines
            if op.capability in machine.capabilities
            and (machine.available or machine.machine_id == failed)
            and (
                op.mold_id is None
                or machine.machine_id in mold_map[op.mold_id].compatible_machine_ids
            )
        )
        for op in case.operations
    }
    return SchedulingSource(request, case, validation, eligibility)
