from dataclasses import replace
from datetime import timedelta

from sched_copilot.domain import MachineFailure
from sched_copilot.impact import operation_changes, order_impacts
from sched_copilot.scenario import EVENT_TIME, demo_machines, demo_orders, demo_schedule
from sched_copilot.scheduling import generate_candidates


def simulate(hours):
    event = MachineFailure(
        "M1", EVENT_TIME, EVENT_TIME + timedelta(hours=hours), "test", EVENT_TIME
    )
    baseline = demo_schedule()
    candidates = generate_candidates(baseline, event, demo_machines(), demo_orders())
    return baseline, event, candidates


def test_transfer_changes_operations_without_order_lateness():
    baseline, event, candidates = simulate(1)
    transfer = candidates[1]
    assert transfer.metrics.moved_operations > 0
    assert transfer.metrics.late_orders == 0
    assert operation_changes(baseline, transfer, event)
    assert all(row["新延期(分钟)"] == 0 for row in order_impacts(baseline, transfer, demo_orders()))


def test_short_wait_propagates_across_orders_through_shared_machine():
    baseline, event, candidates = simulate(1)
    rows = operation_changes(baseline, candidates[0], event)
    flange = next(row for row in rows if row["工序"] == "O1004-OP2")
    assert flange["类型"] == "连锁影响"
    assert flange["影响链"] == ("故障:M1 → O1002-OP1 → O1002-OP2 → O1004-OP1 → O1004-OP2")
    order = next(
        row
        for row in order_impacts(baseline, candidates[0], demo_orders())
        if row["订单"] == "O1004"
    )
    assert order["新增延期(分钟)"] == 60


def test_long_failure_has_traceable_downstream_delay():
    baseline, event, candidates = simulate(4)
    rows = operation_changes(baseline, candidates[0], event)
    downstream = next(row for row in rows if row["工序"] == "O1002-OP2")
    assert downstream["类型"] == "连锁影响"
    assert downstream["影响链"] == "故障:M1 → O1002-OP1 → O1002-OP2"
    assert downstream["时间变化(分钟)"] == 240
    order = next(
        row
        for row in order_impacts(baseline, candidates[0], demo_orders())
        if row["订单"] == "O1002"
    )
    assert order["新增延期(分钟)"] == 150


def test_no_direct_impact_keeps_all_tasks_including_machine_assignment():
    baseline, event, _ = simulate(1)
    event = replace(event, machine_id="M2")
    for candidate in generate_candidates(baseline, event, demo_machines(), demo_orders()):
        assert candidate.schedule.operations == baseline.operations
        assert not operation_changes(baseline, candidate, event)


def test_window_end_is_exclusive():
    baseline, event, _ = simulate(1)
    # M2's next task begins at 18:00, exactly when this failure recovers.
    event = replace(event, machine_id="M2", recovered_at=EVENT_TIME + timedelta(hours=5))
    for candidate in generate_candidates(baseline, event, demo_machines(), demo_orders()):
        assert candidate.metrics.moved_operations == 0
