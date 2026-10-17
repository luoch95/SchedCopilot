"""调用确定性排产工具，并登记候选、变更与约束检查证据。"""

import hashlib
import json
from dataclasses import dataclass

from ..agents.contracts.artifacts import (
    CandidateChanges,
    CandidateConstraintCheck,
    CandidateSnapshot,
    OperationChange,
)
from ..agents.contracts.common import Evidence, Notice, Statement
from ..agents.contracts.results import CandidateReference, SchedulingData
from ..domain.errors import RuleViolation
from ..domain.impact import operation_changes
from ..domain.models import MachineFailure, Schedule, TaskStatus
from ..domain.scheduling import ASSUMPTIONS, generate_candidates, validate_schedule
from .case_mapping import to_validation_case
from .scheduling_context import SchedulingBlocked, SchedulingSource

RULESET_VERSION = "1.0.0"


@dataclass(frozen=True)
class SchedulingToolOutput:
    """返回结构化候选与证据，调用方负责保存而非发布。"""

    data: SchedulingData
    evidence_catalog: dict[str, Evidence]
    summary_refs: tuple[str, ...]
    warnings: tuple[Notice, ...]


def generate_schedule(source: SchedulingSource) -> SchedulingToolOutput:
    """按指定策略生成；每个候选重新检查约束，按实际工序安排去重。"""
    request, case = source.request, source.case
    domain = to_validation_case(case)
    raw_event = case.failures[0]
    event = MachineFailure(
        raw_event.machine_id,
        raw_event.started_at,
        raw_event.estimated_recovery_at,
        raw_event.source,
        raw_event.received_at,
    )
    # 订单可能尚未进入当前计划，只向旧规则工具提供本计划有工序的订单。
    active_orders = {op.order_id for op in domain.schedule.operations}
    orders = tuple(order for order in domain.orders if order.id in active_orders)
    payload = {
        "context": request.context.model_dump(mode="json"),
        "case": case.model_dump(mode="json"),
        "strategies": [s.model_dump(mode="json") for s in request.allowed_strategies],
        "rules": RULESET_VERSION,
    }
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    batch_id = f"candidate-batch:{digest}"
    catalog: dict[str, Evidence] = {}

    def register(ref, kind, content):
        catalog[ref] = Evidence(
            context=request.context.model_copy(deep=True), kind=kind, content=content
        )

    rules_ref = f"{batch_id}:rules"
    register(
        rules_ref,
        "scheduling_rules",
        {
            "ruleset_version": RULESET_VERSION,
            "assumptions": list(ASSUMPTIONS),
            "unchecked_items": source.validation.data.unchecked_items,
        },
    )
    warnings = []
    limitations = []
    candidates = []
    fingerprints = set()
    refs = [request.current_plan_ref, request.validation_result_ref, rules_ref]
    for strategy in request.allowed_strategies:
        try:
            candidate = generate_candidates(
                domain.schedule,
                event,
                domain.machines,
                orders,
                request.context.event_version,
                strategies=(strategy.strategy_id,),
                eligible_machine_ids=source.eligible_machine_ids,
            )[0]
            _check_schedule(source, candidate.schedule, event)
        except RuleViolation:
            warnings.append(
                Notice(
                    code="STRATEGY_NO_FEASIBLE_CANDIDATE",
                    message=f"策略 {strategy.strategy_id} 未生成通过约束检查的候选。",
                    repair_hint="核对该策略的设备与工序条件，勿以无效方案替代。",
                    evidence_refs=refs,
                )
            )
            limitations.append(f"策略 {strategy.strategy_id} 没有可用候选。")
            continue
        fingerprint = candidate.schedule.fingerprint
        if fingerprint in fingerprints:
            warnings.append(
                Notice(
                    code="DUPLICATE_PLAN_MERGED",
                    message=f"策略 {strategy.strategy_id} 的工序安排与已有候选相同，已合并。",
                    repair_hint="查看保留的候选，不把相同安排作为不同方案比较。",
                    evidence_refs=refs,
                )
            )
            limitations.append(f"策略 {strategy.strategy_id} 与已有候选相同，未重复展示。")
            continue
        fingerprints.add(fingerprint)
        candidate_id = f"{batch_id}:candidate:{fingerprint}"
        plan_ref, changes_ref, check_ref = (
            f"{candidate_id}:{suffix}" for suffix in ("plan", "changes", "check")
        )
        original = {op.operation_id: op for op in case.operations}
        operations = [
            original[op.id].model_copy(update={"machine_id": op.machine_id, "start_at": op.start})
            for op in candidate.schedule.operations
        ]
        snapshot = CandidateSnapshot(
            candidate_id=candidate_id,
            strategy_id=strategy.strategy_id,
            label=candidate.label,
            source_plan_ref=request.current_plan_ref,
            operations=operations,
        )
        changes = CandidateChanges(
            candidate_id=candidate_id,
            items=[
                OperationChange(
                    operation_id=row["工序"],
                    order_id=row["订单"],
                    before_machine_id=row["原设备"],
                    after_machine_id=row["新设备"],
                    before_start=row["原开始"],
                    after_start=row["新开始"],
                    before_end=row["原结束"],
                    after_end=row["新结束"],
                    impact_type=row["类型"],
                    reason=row["依据"],
                    impact_path=row["影响链"],
                    evidence_refs=refs,
                )
                for row in operation_changes(domain.schedule, candidate, event)
            ],
        )
        checked = [
            "operation_set",
            "operation_definitions",
            "machine_capability",
            "machine_overlap",
            "operation_sequence",
            "failure_window",
            "fixed_operations",
            "no_early_start",
            "eligible_machines",
        ]
        if all(op.mold_id is not None for op in case.operations):
            checked.append("physical_mold_compatibility")
        check = CandidateConstraintCheck(
            candidate_id=candidate_id,
            passed=True,
            checked_items=checked,
            unchecked_items=source.validation.data.unchecked_items,
        )
        register(plan_ref, "candidate_plan", snapshot.model_dump(mode="json"))
        register(changes_ref, "candidate_changes", changes.model_dump(mode="json"))
        register(check_ref, "candidate_constraints", check.model_dump(mode="json"))
        candidates.append(
            CandidateReference(
                candidate_id=candidate_id,
                strategy_id=strategy.strategy_id,
                plan_ref=plan_ref,
                changes_ref=changes_ref,
                constraint_check_ref=check_ref,
                evidence_refs=refs,
            )
        )
    if not candidates:
        raise SchedulingBlocked(
            "NO_FEASIBLE_CANDIDATE",
            "所选策略没有生成有效候选。",
            "核对设备、模具和工序条件后重新校验。",
            refs[:2],
        )
    if len(candidates) < 2:
        limitations.append("仅有一个不同的可行候选，未满足多方案比较目标。")
        warnings.append(
            Notice(
                code="SINGLE_CANDIDATE",
                message=limitations[-1],
                repair_hint="人工检查单个候选；不要虚构第二个方案。",
                evidence_refs=refs,
            )
        )
    data = SchedulingData(
        candidate_batch_id=batch_id,
        candidates=candidates,
        assumptions=[Statement(text=text, evidence_refs=[rules_ref]) for text in ASSUMPTIONS],
        limitations=limitations,
    )
    batch_ref = f"{batch_id}:manifest"
    register(batch_ref, "candidate_batch", data.model_dump(mode="json"))
    return SchedulingToolOutput(
        data, catalog, (request.current_plan_ref, rules_ref, batch_ref), tuple(warnings)
    )


def _check_schedule(source: SchedulingSource, schedule: Schedule, event: MachineFailure) -> None:
    """独立复核候选，防止生成过程遗漏约束或错误转移。"""
    domain = to_validation_case(source.case)
    issues = validate_schedule(schedule, domain.machines, event, domain.schedule)
    if issues:
        raise RuleViolation("候选未通过独立约束检查")
    original = {op.id: op for op in domain.schedule.operations}
    for op in schedule.operations:
        if op.status == TaskStatus.PLANNED:
            if (
                op.machine_id not in source.eligible_machine_ids[op.id]
                or op.start < original[op.id].start
            ):
                raise RuleViolation("候选不满足设备资格或原计划时间下界")


def verify_tool_output(source: SchedulingSource, output: SchedulingToolOutput) -> None:
    """核对实际计划、变更和检查记录，不能仅相信工具声明 passed。"""
    request = source.request
    event = source.case.failures[0]
    failure = MachineFailure(
        event.machine_id,
        event.started_at,
        event.estimated_recovery_at,
        event.source,
        event.received_at,
    )
    original = {op.operation_id: op for op in source.case.operations}
    fingerprints = set()
    for candidate in output.data.candidates:
        plan_evidence = output.evidence_catalog[candidate.plan_ref]
        snapshot = CandidateSnapshot.model_validate_json(json.dumps(plan_evidence.content))
        changes = CandidateChanges.model_validate_json(
            json.dumps(output.evidence_catalog[candidate.changes_ref].content)
        )
        check = CandidateConstraintCheck.model_validate(
            output.evidence_catalog[candidate.constraint_check_ref].content
        )
        if (
            snapshot.candidate_id != candidate.candidate_id
            or snapshot.strategy_id != candidate.strategy_id
            or snapshot.source_plan_ref != request.current_plan_ref
            or changes.candidate_id != candidate.candidate_id
            or check.candidate_id != candidate.candidate_id
            or not check.passed
        ):
            raise ValueError("候选证据与引用不一致")
        if check.unchecked_items != source.validation.data.unchecked_items:
            raise ValueError("不能隐藏未检查的生产条件")
        for op in snapshot.operations:
            before = original[op.operation_id]
            expected = before.model_copy(
                update={"machine_id": op.machine_id, "start_at": op.start_at}
            )
            if op != expected:
                raise ValueError("候选修改了工序定义或模具")
        changed_case = source.case.model_copy(update={"operations": snapshot.operations})
        domain = to_validation_case(changed_case)
        schedule = Schedule(1, domain.schedule.operations)
        _check_schedule(source, schedule, failure)
        if schedule.fingerprint in fingerprints:
            raise ValueError("候选中存在相同工序安排")
        fingerprints.add(schedule.fingerprint)
        expected_changes = {
            op.operation_id: op for op in snapshot.operations if op != original[op.operation_id]
        }
        if len(changes.items) != len(expected_changes) or {
            i.operation_id for i in changes.items
        } != set(expected_changes):
            raise ValueError("变更清单与计划不一致")
        for change in changes.items:
            before = original[change.operation_id]
            after = expected_changes[change.operation_id]
            if (
                change.order_id != before.order_id
                or change.before_machine_id != before.machine_id
                or change.after_machine_id != after.machine_id
                or change.before_start != before.start_at
                or change.after_start != after.start_at
            ):
                raise ValueError("变更清单的时间或设备与计划不一致")
        if candidate.strategy_id == "wait-recovery" and any(
            op.machine_id != original[op.operation_id].machine_id for op in snapshot.operations
        ):
            raise ValueError("等待恢复策略不允许设备转移")
    if not output.data.candidates:
        raise ValueError("工具没有返回候选")
    manifest = [
        output.evidence_catalog[ref]
        for ref in output.summary_refs
        if ref in output.evidence_catalog and output.evidence_catalog[ref].kind == "candidate_batch"
    ]
    if len(manifest) != 1 or manifest[0].content != output.data.model_dump(mode="json"):
        raise ValueError("候选批次证据与报告不一致")
