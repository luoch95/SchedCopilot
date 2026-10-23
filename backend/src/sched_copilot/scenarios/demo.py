"""Repeatable injection-molding changeover scenario for Schedule Copilot."""

from datetime import datetime, timedelta, timezone

from ..domain.models import Machine, Operation, Order, Schedule, TaskStatus

BASE_TIME = datetime(2026, 10, 19, 8, tzinfo=timezone(timedelta(hours=8)))
EVENT_TIME = BASE_TIME + timedelta(hours=5)


def demo_machines() -> tuple[Machine, ...]:
    return (
        Machine("M1", "注塑机 M1（160T）", frozenset({"mold_a"})),
        Machine("M2", "注塑机 M2（160T）", frozenset({"mold_a", "mold_b"})),
        Machine("M3", "注塑机 M3（280T）", frozenset({"mold_b", "mold_c"})),
    )


def demo_orders() -> tuple[Order, ...]:
    return (
        Order("O1001", "汽车门板饰件（模具A）", BASE_TIME.replace(hour=15), 1),
        Order("O1002", "连接器壳体（模具A）", BASE_TIME.replace(hour=18), 2),
        Order("O1003", "白色家电内衬（模具B）", BASE_TIME.replace(hour=16), 3),
        Order("O1004", "电池包上盖（模具C）", BASE_TIME.replace(hour=19), 2),
        Order("O1005", "控制面板外壳（模具A）", BASE_TIME.replace(hour=21), 3),
    )


def demo_schedule() -> Schedule:
    data = [
        ("O1001", 1, "mold_a", "M1", 120, 0, TaskStatus.COMPLETED),
        ("O1001", 2, "mold_b", "M3", 120, 120, TaskStatus.COMPLETED),
        ("O1001", 3, "mold_a", "M1", 60, 240, TaskStatus.COMPLETED),
        ("O1002", 1, "mold_a", "M1", 90, 300, TaskStatus.PLANNED),
        ("O1002", 2, "mold_b", "M3", 120, 390, TaskStatus.PLANNED),
        ("O1003", 1, "mold_b", "M2", 120, 0, TaskStatus.COMPLETED),
        ("O1003", 2, "mold_b", "M2", 60, 120, TaskStatus.COMPLETED),
        ("O1004", 1, "mold_c", "M3", 90, 510, TaskStatus.PLANNED),
        ("O1004", 2, "mold_b", "M2", 60, 600, TaskStatus.PLANNED),
        ("O1005", 1, "mold_a", "M1", 90, 390, TaskStatus.PLANNED),
        ("O1005", 2, "mold_a", "M1", 60, 480, TaskStatus.PLANNED),
    ]
    orders = {order.id: order for order in demo_orders()}
    operations = tuple(
        Operation(
            id=f"{order_id}-OP{sequence}",
            order_id=order_id,
            sequence=sequence,
            capability=capability,
            machine_id=machine_id,
            duration_minutes=duration,
            start=BASE_TIME + timedelta(minutes=offset),
            status=status,
        )
        for order_id, sequence, capability, machine_id, duration, offset, status in data
        if order_id in orders
    )
    return Schedule(version=1, operations=operations)
