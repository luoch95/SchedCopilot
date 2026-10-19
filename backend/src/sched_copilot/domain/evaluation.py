"""比较已有计划的确定性指标；不生成或调整工序安排。"""

from .models import Order, Schedule


def compare_plans(
    baseline: Schedule, candidate: Schedule, orders: tuple[Order, ...], machine_ids: list[str]
) -> tuple[dict, dict]:
    """统计完整快照的加工分钟；不将加工量当作班次利用率。"""
    original = {op.id: op for op in baseline.operations}
    changes = []
    for op in candidate.operations:
        before = original[op.id]
        if op.start != before.start or op.machine_id != before.machine_id:
            changes.append(
                {
                    "operation_id": op.id,
                    "order_id": op.order_id,
                    "before_machine_id": before.machine_id,
                    "after_machine_id": op.machine_id,
                    "before_start": before.start.isoformat(),
                    "after_start": op.start.isoformat(),
                    "before_end": before.end.isoformat(),
                    "after_end": op.end.isoformat(),
                    "start_delay_minutes": (op.start - before.start).total_seconds() / 60,
                    "end_delay_minutes": (op.end - before.end).total_seconds() / 60,
                }
            )
    deliveries = []
    missing_orders = []
    for order in orders:
        old = [op.end for op in baseline.operations if op.order_id == order.id]
        new = [op.end for op in candidate.operations if op.order_id == order.id]
        if not old:
            missing_orders.append(order.id)
            continue
        before, after = max(old), max(new)
        old_lateness = max(0, (before - order.due).total_seconds() / 60)
        lateness = max(0, (after - order.due).total_seconds() / 60)
        deliveries.append(
            {
                "order_id": order.id,
                "priority": order.priority,
                "due_at": order.due.isoformat(),
                "before_completion": before.isoformat(),
                "after_completion": after.isoformat(),
                "completion_delay_minutes": (after - before).total_seconds() / 60,
                "baseline_lateness_minutes": old_lateness,
                "lateness_minutes": lateness,
                "lateness_delta_minutes": lateness - old_lateness,
            }
        )
    loads = []
    for machine_id in machine_ids:
        before = sum(
            op.duration_minutes for op in baseline.operations if op.machine_id == machine_id
        )
        after = sum(
            op.duration_minutes for op in candidate.operations if op.machine_id == machine_id
        )
        loads.append(
            {
                "machine_id": machine_id,
                "baseline_processing_minutes": before,
                "processing_minutes": after,
                "delta_minutes": after - before,
            }
        )
    old_end = max(op.end for op in baseline.operations)
    new_end = max(op.end for op in candidate.operations)
    metrics = {
        "scope": "complete_snapshot_including_fixed_operations",
        "time_unit": "minutes",
        "late_orders": sum(row["lateness_minutes"] > 0 for row in deliveries),
        "baseline_late_orders": sum(row["baseline_lateness_minutes"] > 0 for row in deliveries),
        "total_lateness_minutes": sum(row["lateness_minutes"] for row in deliveries),
        "baseline_total_lateness_minutes": sum(
            row["baseline_lateness_minutes"] for row in deliveries
        ),
        "moved_operations": len(changes),
        "transferred_operations": sum(
            row["before_machine_id"] != row["after_machine_id"] for row in changes
        ),
        "delayed_operations": sum(row["end_delay_minutes"] > 0 for row in changes),
        "total_operation_delay_minutes": sum(max(0, row["end_delay_minutes"]) for row in changes),
        "baseline_completion": old_end.isoformat(),
        "completion": new_end.isoformat(),
        "completion_delta_minutes": (new_end - old_end).total_seconds() / 60,
        "machine_loads": loads,
        "extra_changeovers": None,
        "extra_changeover_minutes": None,
        "orders_without_operations": missing_orders,
    }
    return metrics, {"operations": changes, "orders": deliveries}
