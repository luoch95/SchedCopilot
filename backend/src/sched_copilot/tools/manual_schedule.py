"""Register an immutable, server-owned manual candidate without generating a new plan."""

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
from ..domain.manual_editing import check_manual_time_boundary
from .case_mapping import to_validation_case
from .scheduling import SchedulingToolOutput, _check_schedule, verify_tool_output
from .scheduling_context import SchedulingBlocked


def manual_schedule(source, candidate):
    domain = to_validation_case(source.case)
    event = source.case.failures[0]
    # _check_schedule expects the domain failure shape rather than the contract snapshot.
    from ..domain.models import MachineFailure

    failure = MachineFailure(
        event.machine_id,
        event.started_at,
        event.estimated_recovery_at,
        event.source,
        event.received_at,
    )
    try:
        check_manual_time_boundary(domain.schedule, candidate.schedule, domain.report_snapshot_at)
        overtime = _check_schedule(source, candidate.schedule, failure)
    except RuleViolation as exc:
        raise SchedulingBlocked(
            "MANUAL_CONSTRAINT_BLOCKED",
            str(exc),
            "继续手动调整冲突工序后重新评估。",
            [source.request.current_plan_ref, source.request.validation_result_ref],
        ) from exc
    request = source.request
    batch = f"manual-batch:{candidate.id}"
    refs = [request.current_plan_ref, request.validation_result_ref, f"{batch}:rules"]
    plan_ref, changes_ref, check_ref = (f"{candidate.id}:{s}" for s in ("plan", "changes", "check"))
    originals = {op.operation_id: op for op in source.case.operations}
    snapshot = CandidateSnapshot(
        candidate_id=candidate.id,
        strategy_id="allow-transfer",
        label="人工调整方案",
        source_plan_ref=request.current_plan_ref,
        operations=[
            originals[op.id].model_copy(update={"machine_id": op.machine_id, "start_at": op.start})
            for op in candidate.schedule.operations
        ],
    )
    changes = CandidateChanges(
        candidate_id=candidate.id,
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
            for row in operation_changes(domain.schedule, candidate, failure)
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
    if domain.production:
        checked += ["changeover_duration", "physical_mold_occupancy"]
        if not overtime:
            checked.append("shift_calendar")
    check = CandidateConstraintCheck(
        candidate_id=candidate.id,
        passed=True,
        checked_items=checked,
        unchecked_items=source.validation.data.unchecked_items,
    )
    data = SchedulingData(
        candidate_batch_id=batch,
        candidates=[
            CandidateReference(
                candidate_id=candidate.id,
                strategy_id="allow-transfer",
                plan_ref=plan_ref,
                changes_ref=changes_ref,
                constraint_check_ref=check_ref,
                evidence_refs=refs,
            )
        ],
        assumptions=[
            Statement(
                text="人工提交的工序安排保持不变；规则核验设备与时间，未自动增加班次。",
                evidence_refs=[refs[-1]],
            )
        ],
        limitations=["仅核验人工提交的方案；原 AI 候选与报告独立保留。"]
        + list(source.validation.data.unchecked_items)
        + overtime,
    )
    records = {
        refs[-1]: (
            "scheduling_rules",
            {
                "source": "manual",
                "candidate_id": candidate.id,
                "schedule_fingerprint": candidate.schedule.fingerprint,
            },
        ),
        plan_ref: ("candidate_plan", snapshot.model_dump(mode="json")),
        changes_ref: ("candidate_changes", changes.model_dump(mode="json")),
        check_ref: ("candidate_constraints", check.model_dump(mode="json")),
        f"{batch}:manifest": ("candidate_batch", data.model_dump(mode="json")),
    }
    output = SchedulingToolOutput(
        data,
        {
            ref: Evidence(context=request.context, kind=kind, content=content)
            for ref, (kind, content) in records.items()
        },
        (request.current_plan_ref, refs[-1], f"{batch}:manifest"),
        (
            Notice(
                code="SINGLE_MANUAL_CANDIDATE",
                message="仅评估人工提交的方案，未自动重新排产。",
                repair_hint="可切换原 AI 分析比较与选择。",
                evidence_refs=refs,
            ),
        )
        + tuple(
            Notice(
                code="SHIFT_OVERRUN_REQUIRES_REVIEW",
                message=risk,
                repair_hint="提交管理者确认超班风险。",
                evidence_refs=refs,
            )
            for risk in overtime
        ),
    )
    verify_tool_output(source, output)
    return output
