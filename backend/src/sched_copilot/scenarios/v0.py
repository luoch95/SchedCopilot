"""Approved local V0 fixture; construction never writes the active database."""

from dataclasses import replace
from datetime import datetime, timedelta

from ..domain.models import Schedule, TaskStatus
from .demo import demo_orders, demo_schedule
from .production_demo import demo_production_inputs


def v0_data():
    clock = datetime.fromisoformat("2026-10-26T10:00:00+08:00")
    placements = {
        "O1001-OP1": ("M1", 8, 0),
        "O1001-OP2": ("M3", 10, 30),
        "O1001-OP3": ("M1", 13, 0),
        "O1002-OP1": ("M1", 10, 30),
        "O1002-OP2": ("M3", 13, 0),
        "O1003-OP1": ("M2", 8, 0),
        "O1003-OP2": ("M2", 10, 30),
        "O1004-OP1": ("M3", 16, 15),
        "O1004-OP2": ("M2", 18, 0),
        "O1005-OP1": ("M1", 14, 30),
        "O1005-OP2": ("M1", 16, 30),
    }
    operations = []
    for op in demo_schedule().operations:
        machine, hour, minute = placements[op.id]
        start = clock.replace(hour=hour, minute=minute)
        operations.append(
            replace(
                op,
                machine_id=machine,
                start=start,
                status=TaskStatus.COMPLETED
                if start + timedelta(minutes=op.duration_minutes) <= clock
                else TaskStatus.PLANNED,
            )
        )
    orders = tuple(replace(o, due=o.due + timedelta(days=7)) for o in demo_orders())
    production = demo_production_inputs()
    production["dataset_id"] = "injection-v0-20261026"
    for shift in production["production"]["shifts"]:
        for key in ("start_at", "end_at"):
            shift[key] = (datetime.fromisoformat(shift[key]) + timedelta(days=7)).isoformat()
    return Schedule(0, tuple(operations)), orders, clock, production
