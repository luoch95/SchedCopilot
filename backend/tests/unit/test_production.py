"""Calendar, setup and physical-mold constraints are independently verified."""

from dataclasses import replace
from datetime import timedelta

import pytest

from sched_copilot.domain.errors import RuleViolation
from sched_copilot.domain.models import MachineFailure, Operation, Schedule
from sched_copilot.domain.production import ProductionResources
from sched_copilot.scenarios.demo import BASE_TIME


def at(minutes):
    return BASE_TIME + timedelta(minutes=minutes)


@pytest.fixture
def resources():
    return ProductionResources(
        "simulation",
        {"M1": ((at(0), at(120)), (at(180), at(360))), "M2": ((at(0), at(360)),)},
        {"a": "A", "b": "B", "c": "B"},
        {"M1": "A", "M2": "A"},
        15,
    )


@pytest.fixture
def failure():
    return MachineFailure("M1", at(30), at(60), "simulation", at(30))


def operation(identifier, machine, start, duration=60):
    return Operation(identifier, identifier, 1, "mold_a", machine, duration, at(start))


def test_setup_respects_failure_and_calendar_gap(resources, failure):
    op = operation("b", "M1", 0)
    assert resources.place(op, "M1", at(0), {}, failure) == at(195)
    assert resources.check(Schedule(1, (op.move_to("M1", at(195)),)), failure) == []
    with pytest.raises(RuleViolation):
        resources.place(op, "M1", at(350), {}, failure)


def test_physical_mold_and_setup_conflicts_are_rejected(resources, failure):
    first = operation("b", "M1", 195)
    second = operation("c", "M2", 210)
    assert resources.check(Schedule(1, (first, second)), failure)
    assert resources.place(second, "M2", at(200), {"b": first}, failure) == at(270)
    assert resources.check(
        Schedule(1, (operation("a", "M2", 0), operation("b", "M2", 60))), failure
    )


def test_utilization_deducts_only_failure_overlap(resources, failure):
    plan = Schedule(1, (operation("b", "M1", 195),))
    totals, loads = resources.evaluate(plan, plan, failure)
    assert totals["changeover_minutes"] == 15
    assert totals["extra_changeover_minutes"] == 0
    assert loads["M1"]["available_minutes"] == 270
    assert loads["M1"]["utilization"] == pytest.approx(75 / 270)


def test_invalid_shift_configuration_is_rejected(resources):
    from sched_copilot.scenarios.demo import demo_machines, demo_schedule

    invalid = replace(resources, shifts={"unknown": ((at(60), at(30)),)})
    assert invalid.configuration_errors(demo_schedule(), demo_machines())
