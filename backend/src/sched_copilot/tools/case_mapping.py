"""在通信快照与领域模型之间转换，不修改源数据。"""

from ..agents.contracts.inputs import SchedulingCase
from ..domain.models import Machine, Operation, Order, Schedule, TaskStatus
from ..domain.production import ProductionResources
from ..domain.validation import FailureRecord, MoldCompatibility, ValidationCase


def to_validation_case(case: SchedulingCase) -> ValidationCase:
    """内部规则使用局部计划序号，正式计划版本仍由上下文保存。"""
    return ValidationCase(
        schedule=Schedule(
            0,
            tuple(
                Operation(
                    op.operation_id,
                    op.order_id,
                    op.sequence,
                    op.capability,
                    op.machine_id,
                    op.duration_minutes,
                    op.start_at,
                    TaskStatus(op.status),
                )
                for op in case.operations
            ),
        ),
        machines=tuple(
            Machine(m.machine_id, m.machine_id, frozenset(m.capabilities)) for m in case.machines
        ),
        orders=tuple(Order(o.order_id, o.order_id, o.due_at, o.priority) for o in case.orders),
        failures=tuple(
            FailureRecord(
                f.event_id, f.machine_id, f.started_at, f.estimated_recovery_at, f.received_at
            )
            for f in case.failures
        ),
        molds=tuple(
            MoldCompatibility(m.mold_id, tuple(m.compatible_machine_ids)) for m in case.molds
        ),
        operation_molds=tuple(op.mold_id for op in case.operations),
        unavailable_machine_ids=frozenset(m.machine_id for m in case.machines if not m.available),
        report_snapshot_at=case.report_snapshot_at,
        wip_policy=case.wip_policy,
        production=production_resources(case),
    )


def production_resources(case: SchedulingCase) -> ProductionResources | None:
    if case.production is None:
        return None
    data = case.production
    return ProductionResources(
        source=data.source,
        shifts={
            machine_id: tuple(
                (shift.start_at, shift.end_at)
                for shift in data.shifts
                if shift.machine_id == machine_id
            )
            for machine_id in {m.machine_id for m in case.machines}
            | {s.machine_id for s in data.shifts}
        },
        operation_molds={o.operation_id: o.mold_id for o in case.operations if o.mold_id},
        initial_molds=dict(data.initial_molds),
        changeover_minutes=data.changeover_minutes,
    )
