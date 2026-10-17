"""在通信快照与领域模型之间转换，不修改源数据。"""

from ..agents.contracts.inputs import SchedulingCase
from ..domain.models import Machine, Operation, Order, Schedule, TaskStatus
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
    )
