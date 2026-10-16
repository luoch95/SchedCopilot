"""Repeatable demo data for the first Schedule Copilot workflow."""

from datetime import datetime, timedelta, timezone

from ..domain.models import Machine, Operation, Order, Schedule, TaskStatus

BASE_TIME = datetime(2026, 10, 19, 8, tzinfo=timezone(timedelta(hours=8)))
EVENT_TIME = BASE_TIME + timedelta(hours=5)


def demo_machines() -> tuple[Machine, ...]:
    return (
        Machine("M1", "车削中心 M1", frozenset({"turning", "finishing"})),
        Machine("M2", "车削中心 M2", frozenset({"turning", "finishing"})),
        Machine("M3", "加工中心 M3", frozenset({"milling", "drilling"})),
    )


def demo_orders() -> tuple[Order, ...]:
    return (
        Order("O1001", "泵轴组件", BASE_TIME.replace(hour=15), 1),
        Order("O1002", "阀体组件", BASE_TIME.replace(hour=18), 2),
        Order("O1003", "联轴器", BASE_TIME.replace(hour=16), 3),
        Order("O1004", "法兰盘", BASE_TIME.replace(hour=19), 2),
        Order("O1005", "调节杆", BASE_TIME.replace(hour=21), 3),
    )


def demo_schedule() -> Schedule:
    data = [
        ("O1001", 1, "turning", "M1", 120, 0, TaskStatus.COMPLETED),
        ("O1001", 2, "milling", "M3", 120, 120, TaskStatus.COMPLETED),
        ("O1001", 3, "finishing", "M1", 60, 240, TaskStatus.COMPLETED),
        ("O1002", 1, "turning", "M1", 90, 300, TaskStatus.PLANNED),
        ("O1002", 2, "milling", "M3", 120, 390, TaskStatus.PLANNED),
        ("O1003", 1, "turning", "M2", 120, 0, TaskStatus.COMPLETED),
        ("O1003", 2, "finishing", "M2", 60, 120, TaskStatus.COMPLETED),
        ("O1004", 1, "milling", "M3", 90, 510, TaskStatus.PLANNED),
        ("O1004", 2, "finishing", "M2", 60, 600, TaskStatus.PLANNED),
        ("O1005", 1, "turning", "M1", 90, 390, TaskStatus.PLANNED),
        ("O1005", 2, "finishing", "M1", 60, 480, TaskStatus.PLANNED),
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
