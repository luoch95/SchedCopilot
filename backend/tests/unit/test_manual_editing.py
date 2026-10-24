from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from sched_copilot.domain.errors import RuleViolation
from sched_copilot.domain.manual_editing import check_manual_time_boundary
from sched_copilot.domain.models import Operation, Schedule, TaskStatus


def test_past_and_crossing_planned_operations_are_locked_but_unchanged_history_is_allowed():
    boundary = datetime(2026, 10, 19, 13, tzinfo=timezone.utc)
    for duration in (30, 120):
        op = Operation(
            "O1-OP1",
            "O1",
            1,
            "turn",
            "M1",
            duration,
            boundary - timedelta(hours=1),
            TaskStatus.PLANNED,
        )
        before = Schedule(1, (op,))
        check_manual_time_boundary(before, before, boundary)
        with pytest.raises(RuleViolation, match="核实报工"):
            check_manual_time_boundary(
                before, Schedule(2, (replace(op, machine_id="M2"),)), boundary
            )


def test_future_operation_can_move_at_boundary_but_not_into_the_past():
    boundary = datetime(2026, 10, 19, 13, tzinfo=timezone.utc)
    op = Operation(
        "O1-OP1", "O1", 1, "turn", "M1", 60, boundary + timedelta(hours=1), TaskStatus.PLANNED
    )
    before = Schedule(1, (op,))
    check_manual_time_boundary(before, Schedule(2, (replace(op, start=boundary),)), boundary)
    with pytest.raises(RuleViolation, match="不能移入"):
        check_manual_time_boundary(
            before, Schedule(2, (replace(op, start=boundary - timedelta(minutes=5)),)), boundary
        )
