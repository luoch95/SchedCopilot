"""调用确定性排产工具，并登记候选、变更与约束检查证据。"""

import hashlib
import json
from dataclasses import dataclass, replace

from ..agents.contracts.artifacts import (
    CandidateChanges,
    CandidateConstraintCheck,
    CandidateSnapshot,
    OperationChange,
)
from ..agents.contracts.common import Evidence, Notice, Statement
from ..agents.contracts.results import CandidateReference, SchedulingData
from ..domain.errors import RuleViolation, ShiftCapacityExceeded
from ..domain.impact import operation_changes
from ..domain.models import MachineFailure, Schedule, TaskStatus
from ..domain.scheduling import (
    ASSUMPTIONS,
    affected_operations,
    generate_candidates,
    validate_schedule,
)
from .case_mapping import to_validation_case
from .scheduling_context import SchedulingBlocked, SchedulingSource

RULESET_VERSION = "1.3.0"


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
    assumptions = list(ASSUMPTIONS)
    if domain.production:
        assumptions = [
            f"生产资源来源：{domain.production.source}",
            f"按登记班次排产；不同实体模具换型需 {domain.production.changeover_minutes} 分钟。",
            "物料、人员及模具保养尚未建模；预计恢复时间为人工估计。",
            "合格设备加工时长相同；规则方案不保证最优，正式发布仍需人工确认。",
        ]
    assumptions.append(
        "原计划对照保留原设备及加工顺序顺延；班次容纳不下时，将受影响工序及后续工序排到原线队尾，允许超班但必须人工确认；"
        "允许转移方案比较全部待加工工序的合格设备，优先最早开工，"
        "同一开工时间优先原设备，因此也可能主动转移未在故障设备上的工序。"
    )
    raw_event = case.failures[0]
    additional_failures = tuple(
        MachineFailure(
            item.machine_id,
            item.started_at,
            item.estimated_recovery_at,
            "历史故障",
            item.received_at,
        )
        for item in domain.failures[1:]
    )
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
            "assumptions": assumptions,
            "unchecked_items": source.validation.data.unchecked_items,
        },
    )
    warnings = []
    limitations = []
    candidates = []
    fingerprints = set()
    strategy_failures = []
    refs = [request.current_plan_ref, request.validation_result_ref, rules_ref]
    for strategy in request.allowed_strategies:
        queue_policy = "preserve"
        try:
            arguments = dict(
                strategies=(strategy.strategy_id,),
                eligible_machine_ids=source.eligible_machine_ids,
                production=domain.production,
                additional_failures=additional_failures,
            )
            try:
                candidate = generate_candidates(
                    domain.schedule,
                    event,
                    domain.machines,
                    orders,
                    request.context.event_version,
                    **arguments,
                )[0]
            except ShiftCapacityExceeded:
                if strategy.strategy_id != "wait-recovery" or not domain.production:
                    raise
                queue_policy = "append_tail"
                arguments.update(
                    production=replace(domain.production, allow_overtime=True),
                    append_tail=True,
                )
                candidate = generate_candidates(
                    domain.schedule,
                    event,
                    domain.machines,
                    orders,
                    request.context.event_version,
                    **arguments,
                )[0]
                candidate = replace(candidate, label="原线排尾顺延（需确认超班）")
            _check_schedule(source, candidate.schedule, event)
        except RuleViolation as exc:
            label = {"wait-recovery": "等待恢复", "allow-transfer": "允许合格设备转移"}[
                strategy.strategy_id
            ]
            reason = f"{label}：{exc}"
            strategy_failures.append(reason)
            warnings.append(
                Notice(
                    code="STRATEGY_NO_FEASIBLE_CANDIDATE",
                    message=reason,
                    repair_hint="根据具体冲突调整生产条件后重新生成；已生成的其他候选仍可查看。",
                    evidence_refs=refs,
                )
            )
            limitations.append(reason)
            continue
        overtime = domain.production.overtime_risks(candidate.schedule) if domain.production else []
        for risk in overtime:
            limitations.append(risk)
            warnings.append(
                Notice(
                    code="SHIFT_OVERRUN_REQUIRES_REVIEW",
                    message=risk,
                    repair_hint="采纳后提交管理者审批；不采纳则进入人工调整。",
                    evidence_refs=refs,
                )
            )
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
        if domain.production:
            checked.extend(["changeover_duration", "physical_mold_occupancy"])
            if not overtime:
                checked.append("shift_calendar")
        check = CandidateConstraintCheck(
            queue_policy=queue_policy,
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
            "本次所选策略均未生成可用方案。" + " ".join(strategy_failures),
            "请按实际生产安排补录后续班次，或调整工序安排后重新生成。"
            if any("班次范围内没有可用时段" in reason for reason in strategy_failures)
            else "请根据上述具体冲突核对设备能力、模具兼容关系和工序安排，再重新生成。",
            refs[:2],
        )
    if len(candidates) < 2:
        limitations.append("当前策略下仅有一个不同的可行候选，将继续评价并解释其影响与风险。")
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
        assumptions=[Statement(text=text, evidence_refs=[rules_ref]) for text in assumptions],
        limitations=limitations,
    )
    batch_ref = f"{batch_id}:manifest"
    register(batch_ref, "candidate_batch", data.model_dump(mode="json"))
    return SchedulingToolOutput(
        data, catalog, (request.current_plan_ref, rules_ref, batch_ref), tuple(warnings)
    )


def _check_schedule(
    source: SchedulingSource, schedule: Schedule, event: MachineFailure
) -> list[str]:
    """独立复核候选，防止生成过程遗漏约束或错误转移。"""
    domain = to_validation_case(source.case)
    failures = tuple(
        MachineFailure(
            f.machine_id,
            f.started_at,
            f.estimated_recovery_at,
            "历史故障",
            f.received_at,
        )
        for f in domain.failures[1:]
    )
    issues = validate_schedule(schedule, domain.machines, event, domain.schedule, failures)
    if domain.production:
        issues += tuple(replace(domain.production, allow_overtime=True).check(schedule, event))
    if issues:
        raise RuleViolation("候选未通过独立约束检查：" + "；".join(issues))
    original = {op.id: op for op in domain.schedule.operations}
    for op in schedule.operations:
        if op.status == TaskStatus.PLANNED:
            if (
                op.machine_id not in source.eligible_machine_ids[op.id]
                or op.start < original[op.id].start
            ):
                raise RuleViolation(
                    f"工序 {op.id} 的候选设备 {op.machine_id} 不在合格设备清单内，"
                    "或开工时间早于原计划；该候选不能使用。"
                )

    return domain.production.overtime_risks(schedule) if domain.production else []


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
        if check.queue_policy == "append_tail" and (
            candidate.strategy_id != "wait-recovery" or not domain.production
        ):
            raise ValueError("排尾兜底仅适用于原线等待策略")
        if check.queue_policy == "append_tail":
            baseline = to_validation_case(source.case)
            tail = {
                op.id
                for blocked in (
                    MachineFailure(
                        item.machine_id,
                        item.started_at,
                        item.estimated_recovery_at,
                        item.source,
                        item.received_at,
                    )
                    for item in source.case.failures
                )
                for op in affected_operations(baseline.schedule, blocked)
            }
            while True:
                expanded = tail | {
                    op.id
                    for op in baseline.schedule.operations
                    if op.status == TaskStatus.PLANNED
                    and any(
                        prev.id in tail
                        and prev.order_id == op.order_id
                        and prev.sequence < op.sequence
                        for prev in baseline.schedule.operations
                    )
                }
                if expanded == tail:
                    break
                tail = expanded
            for machine in domain.machines:
                regular = [
                    op
                    for op in schedule.operations
                    if op.machine_id == machine.id and op.id not in tail
                ]
                deferred = [
                    op
                    for op in schedule.operations
                    if op.machine_id == machine.id and op.id in tail
                ]
                if (
                    regular
                    and deferred
                    and max(op.end for op in regular) > min(op.start for op in deferred)
                ):
                    raise ValueError("排尾兜底必须将受影响工序及后续工序排到原设备队尾")
        if candidate.strategy_id == "wait-recovery" and check.queue_policy == "preserve":
            for machine in domain.machines:
                before_queue = [
                    op.id
                    for op in sorted(
                        (
                            o
                            for o in to_validation_case(source.case).schedule.operations
                            if o.machine_id == machine.id
                        ),
                        key=lambda o: (o.start, o.id),
                    )
                ]
                after_queue = [
                    op.id
                    for op in sorted(
                        (o for o in schedule.operations if o.machine_id == machine.id),
                        key=lambda o: (o.start, o.id),
                    )
                ]
                if before_queue != after_queue:
                    raise ValueError("等待恢复策略不允许改变原设备加工顺序")
    if not output.data.candidates:
        raise ValueError("工具没有返回候选")
    manifest = [
        output.evidence_catalog[ref]
        for ref in output.summary_refs
        if ref in output.evidence_catalog and output.evidence_catalog[ref].kind == "candidate_batch"
    ]
    if len(manifest) != 1 or manifest[0].content != output.data.model_dump(mode="json"):
        raise ValueError("候选批次证据与报告不一致")
