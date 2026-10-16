"""Auditable changes and order-level consequences; no language-model inference."""

from .domain import CandidatePlan, MachineFailure, Order, Schedule
from .scheduling import affected_operations


def operation_changes(
    baseline: Schedule,
    candidate: CandidatePlan,
    event: MachineFailure,
) -> list[dict]:
    original = {op.id: op for op in baseline.operations}
    direct = {op.id for op in affected_operations(baseline, event)}
    causes = dict(candidate.causes)
    root = f"故障:{event.machine_id}"

    def path_to_fault(op_id: str, visited: frozenset[str] = frozenset()) -> tuple[str, ...]:
        if op_id == root:
            return (root,)
        if op_id in visited:
            return ()
        for cause in causes.get(op_id, ()):
            path = path_to_fault(cause, visited | {op_id})
            if path:
                return (*path, op_id)
        return ()

    rows = []
    for op in candidate.schedule.operations:
        before = original[op.id]
        if before.start == op.start and before.machine_id == op.machine_id:
            continue
        path = path_to_fault(op.id)
        kind = "直接影响" if op.id in direct else "连锁影响" if path else "策略调整"
        blockers = causes.get(op.id, ())
        rows.append(
            {
                "工序": op.id,
                "订单": op.order_id,
                "类型": kind,
                "原设备": before.machine_id,
                "新设备": op.machine_id,
                "原开始": before.start,
                "新开始": op.start,
                "原结束": before.end,
                "新结束": op.end,
                "时间变化(分钟)": int((op.start - before.start).total_seconds() // 60),
                "依据": "、".join(blockers) or "规则调度策略选择，未识别到故障传导路径",
                "影响链": " → ".join(path) or "非故障传导的策略调整",
            }
        )
    return rows


def order_impacts(
    baseline: Schedule, candidate: CandidatePlan, orders: tuple[Order, ...]
) -> list[dict]:
    rows = []
    for order in orders:
        before = max(op.end for op in baseline.operations if op.order_id == order.id)
        after = max(op.end for op in candidate.schedule.operations if op.order_id == order.id)
        old_late = max(0, int((before - order.due).total_seconds() // 60))
        new_late = max(0, int((after - order.due).total_seconds() // 60))
        rows.append(
            {
                "订单": order.id,
                "名称": order.name,
                "交期": order.due,
                "原完工": before,
                "新完工": after,
                "原延期(分钟)": old_late,
                "新延期(分钟)": new_late,
                "新增延期(分钟)": new_late - old_late,
                "判断": "新增延期"
                if new_late > old_late
                else "已有延期"
                if new_late
                else "完工变化但未延期"
                if after != before
                else "未变化",
            }
        )
    return rows
