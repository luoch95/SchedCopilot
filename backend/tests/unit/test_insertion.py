"""Deterministic insertion scenarios and independent resource checks."""

from dataclasses import replace
from datetime import timedelta

import pytest

from sched_copilot.domain.errors import RuleViolation
from sched_copilot.domain.insertion import (
    InsertionResources,
    ProcessStep,
    trial_insertion,
    validate_insertion,
)
from sched_copilot.domain.models import Machine, Operation, Order, Schedule, TaskStatus
from sched_copilot.scenarios.demo import EVENT_TIME, demo_machines, demo_orders, demo_schedule
from sched_copilot.scenarios.insertion_demo import demo_routes, insertion_resources
from sched_copilot.scenarios.sales_catalog import demo_products


def simple_case(due_minutes=120, existing_due=180):
    t = EVENT_TIME
    machines = (Machine("M1", "machine", frozenset({"a"})),)
    original = Operation("O1-1", "O1", 1, "a", "M1", 60, t + timedelta(minutes=15))
    baseline = Schedule(1, (original,))
    steps = (ProcessStep(1, "注塑", "a", "URG-MOLD", ("M1",)),)
    resources = InsertionResources(
        {"O1-1": "OLD-MOLD", "URG-test-OP1": "URG-MOLD"},
        {"OLD-MOLD": ("M1",), "URG-MOLD": ("M1",)},
        {"M1": ((t, t + timedelta(hours=8)),)},
        {"M1": "OLD-MOLD"},
        15,
        "test",
    )
    orders = (Order("O1", "original", t + timedelta(minutes=existing_due), 1),)
    return baseline, machines, orders, steps, resources, t + timedelta(minutes=due_minutes)


@pytest.mark.parametrize(
    "due_minutes,existing_due,meets,new_delays",
    [
        (120, 180, True, 0),
        (120, 80, True, 1),
        (30, 180, False, 0),
    ],
)
def test_three_business_cases_have_exact_completion_and_delay(
    due_minutes, existing_due, meets, new_delays
):
    baseline, machines, orders, steps, resources, due = simple_case(due_minutes, existing_due)
    fingerprint = baseline.fingerprint
    result = trial_insertion(
        baseline, machines, orders, "test", due, EVENT_TIME, EVENT_TIME, 30, steps, resources
    )
    summary = result["summary"]
    assert summary["estimated_completion_at"] == (EVENT_TIME + timedelta(minutes=45)).isoformat()
    assert summary["meets_due"] is meets
    assert summary["affected_order_count"] == 1
    assert summary["newly_delayed_order_count"] == new_delays
    row = summary["order_impacts"][0]
    assert row["projected_completion_at"] == (EVENT_TIME + timedelta(minutes=120)).isoformat()
    assert row["delay_delta_minutes"] == (40 if existing_due == 80 else 0)
    assert baseline.fingerprint == fingerprint


def test_fixed_started_completed_and_future_fixed_work_are_preserved():
    baseline, machines, orders, steps, resources, due = simple_case()
    fixed = replace(
        baseline.operations[0],
        status=TaskStatus.IN_PROGRESS,
        start=EVENT_TIME - timedelta(minutes=30),
    )
    baseline = replace(baseline, operations=(fixed,))
    resources = replace(
        resources,
        shifts={"M1": ((EVENT_TIME - timedelta(hours=2), EVENT_TIME + timedelta(hours=8)),)},
    )
    result = trial_insertion(
        baseline, machines, orders, "test", due, EVENT_TIME, EVENT_TIME, 30, steps, resources
    )
    kept = next(o for o in result["details"]["operations"] if o["operation_id"] == fixed.id)
    assert kept["start"] == fixed.start.isoformat()
    assert kept["end"] == fixed.end.isoformat()
    assert kept["status"] == "in_progress"


def test_mold_sharing_across_machines_is_serialized():
    baseline, machines, orders, steps, resources, due = simple_case()
    machines = (*machines, Machine("M2", "machine2", frozenset({"a"})))
    resources = replace(
        resources,
        operation_molds={"O1-1": "URG-MOLD", "URG-test-OP1": "URG-MOLD"},
        mold_machines={"URG-MOLD": ("M1", "M2")},
        shifts={m.id: resources.shifts["M1"] for m in machines},
        initial_molds={m.id: "URG-MOLD" for m in machines},
    )
    steps = (replace(steps[0], machine_ids=("M1", "M2")),)
    result = trial_insertion(
        baseline, machines, orders, "test", due, EVENT_TIME, EVENT_TIME, 30, steps, resources
    )
    rows = result["details"]["operations"]
    old = next(o for o in rows if o["operation_id"] == "O1-1")
    new = next(o for o in rows if o["order_id"] == "URG-test")
    assert old["start"] >= new["end"]


def test_resource_failure_is_not_a_fake_delivery_result():
    baseline, machines, orders, steps, resources, due = simple_case()
    with pytest.raises(RuleViolation, match="班次"):
        trial_insertion(
            baseline, machines, orders, "test", due, EVENT_TIME, EVENT_TIME, 1000, steps, resources
        )


def test_independent_validator_detects_fixed_work_changes():
    baseline, machines, _, _, resources, _ = simple_case()
    fixed = replace(baseline.operations[0], status=TaskStatus.COMPLETED)
    baseline = replace(baseline, operations=(fixed,))
    changed = replace(
        baseline, operations=(replace(fixed, start=fixed.start + timedelta(minutes=5)),)
    )
    assert any(
        "必须固定" in e
        for e in validate_insertion(changed, baseline, machines, resources, EVENT_TIME)
    )


@pytest.mark.parametrize("product_index", [0, 1, 2])
def test_real_demo_routes_are_valid_and_deterministic(product_index):
    product = demo_products()[product_index]
    steps = demo_routes()[product.id]
    baseline = demo_schedule()
    resources = insertion_resources(baseline, "test", steps)

    def run():
        return trial_insertion(
            baseline,
            demo_machines(),
            demo_orders(),
            "test",
            EVENT_TIME + timedelta(days=2),
            EVENT_TIME,
            EVENT_TIME,
            product.estimate(100)["planned_minutes"],
            steps,
            resources,
        )

    result = run()
    assert result == run()
    for op in baseline.operations:
        if op.status != TaskStatus.PLANNED:
            row = next(o for o in result["details"]["operations"] if o["operation_id"] == op.id)
            assert row["start"] == op.start.isoformat()
            assert row["machine_id"] == op.machine_id
    assert len(result["details"]["operations"]) == len(baseline.operations) + len(steps)
