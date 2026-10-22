from dataclasses import replace
from datetime import timedelta

import pytest

from sched_copilot.domain.models import MachineFailure
from sched_copilot.domain.scheduling import (
    affected_operations,
    generate_candidates,
    validate_schedule,
)
from sched_copilot.scenarios.demo import BASE_TIME, demo_machines, demo_orders, demo_schedule


def failure():
    return MachineFailure(
        "M1",
        BASE_TIME + timedelta(hours=5),
        BASE_TIME + timedelta(hours=9),
        "test",
        BASE_TIME + timedelta(hours=5),
    )


def test_demo_schedule_is_valid():
    assert validate_schedule(demo_schedule(), demo_machines()) == ()


def test_failure_only_affects_planned_operations_on_failed_machine():
    affected = affected_operations(demo_schedule(), failure())
    assert {item.id for item in affected} == {"O1002-OP1", "O1005-OP1", "O1005-OP2"}


def test_candidates_are_traceable_and_valid():
    candidates = generate_candidates(demo_schedule(), failure(), demo_machines(), demo_orders())
    assert {candidate.id for candidate in candidates} == {"wait-recovery", "allow-transfer"}
    assert all(candidate.evidence and candidate.assumptions for candidate in candidates)
    assert all(
        not validate_schedule(candidate.schedule, demo_machines(), failure(), demo_schedule())
        for candidate in candidates
    )


def test_replan_keeps_other_machine_outage_as_a_resource_constraint():
    baseline = demo_schedule()
    current = MachineFailure(
        "M2",
        BASE_TIME.replace(hour=13),
        BASE_TIME.replace(hour=15),
        "M2停机",
        BASE_TIME.replace(hour=13),
    )
    other = MachineFailure(
        "M3",
        BASE_TIME.replace(hour=13),
        BASE_TIME.replace(hour=17),
        "历史M3停机",
        BASE_TIME.replace(hour=13),
    )

    candidates = generate_candidates(
        baseline,
        current,
        demo_machines(),
        demo_orders(),
        additional_failures=(other,),
    )

    for candidate in candidates:
        op = candidate.schedule.by_id("O1002-OP2")
        assert op.machine_id != "M3" or op.start >= other.recovered_at
        assert not validate_schedule(
            candidate.schedule, demo_machines(), current, baseline, (other,)
        )

    invalid_operations = tuple(
        replace(op, machine_id="M3", start=BASE_TIME.replace(hour=14))
        if op.id == "O1002-OP2"
        else op
        for op in baseline.operations
    )
    invalid = replace(baseline, operations=invalid_operations)
    assert any(
        "M3" in error and "故障窗口冲突" in error
        for error in validate_schedule(invalid, demo_machines(), current, baseline, (other,))
    )


def test_blockout_search_skips_adjacent_failure_and_operation_windows():
    baseline = demo_schedule()
    current = MachineFailure(
        "M2",
        BASE_TIME.replace(hour=13),
        BASE_TIME.replace(hour=15),
        "M2",
        BASE_TIME.replace(hour=13),
    )
    m3 = MachineFailure(
        "M3",
        BASE_TIME.replace(hour=13),
        BASE_TIME.replace(hour=17),
        "M3",
        BASE_TIME.replace(hour=13),
    )
    candidates = generate_candidates(
        baseline, current, demo_machines(), demo_orders(), additional_failures=(m3,)
    )
    op = candidates[1].schedule.by_id("O1002-OP2")
    assert not (op.machine_id == "M3" and op.start < m3.recovered_at)


def test_candidate_is_bound_to_baseline_and_event():
    candidate = generate_candidates(demo_schedule(), failure(), demo_machines(), demo_orders())[0]
    assert candidate.baseline_fingerprint == demo_schedule().fingerprint
    assert candidate.event_fingerprint


def test_manual_expected_metrics_and_fixed_completed_tasks():
    baseline = demo_schedule()
    wait, transfer = generate_candidates(baseline, failure(), demo_machines(), demo_orders())
    # M3 must keep O1002-OP2 before O1004-OP1, even when O1002 is delayed.
    assert (wait.metrics.late_orders, wait.metrics.total_lateness_minutes) == (2, 390)
    assert wait.metrics.moved_operations == 6
    assert wait.metrics.makespan == BASE_TIME.replace(hour=23)
    assert (transfer.metrics.late_orders, transfer.metrics.moved_operations) == (0, 3)
    for candidate in (wait, transfer):
        for operation in baseline.operations:
            if operation.status != "planned":
                assert candidate.schedule.by_id(operation.id) == operation


def test_unknown_recovery_requires_human_input():
    with pytest.raises(ValueError, match="人工补充"):
        generate_candidates(
            demo_schedule(), replace(failure(), recovered_at=None), demo_machines(), demo_orders()
        )


def test_machine_failure_during_completed_or_running_work_is_not_silently_replanned():
    event = replace(failure(), started_at=BASE_TIME + timedelta(minutes=30))
    with pytest.raises(ValueError, match="加工中故障"):
        generate_candidates(demo_schedule(), event, demo_machines(), demo_orders())


def test_validator_rejects_precedence_overlap_and_wrong_machine():
    baseline = demo_schedule()
    tasks = list(baseline.operations)
    tasks[4] = replace(tasks[4], start=BASE_TIME.replace(hour=13))
    invalid = replace(baseline, operations=tuple(tasks))
    assert any("必须先于" in error for error in validate_schedule(invalid, demo_machines()))
    tasks[4] = replace(tasks[4], machine_id="M1")
    errors = validate_schedule(replace(baseline, operations=tuple(tasks)), demo_machines())
    assert any("资格" in error for error in errors)
    assert any("重叠" in error for error in errors)


def test_wait_preserves_published_machine_queue_despite_changed_due_date():
    baseline = demo_schedule()
    # Urgent later work must not overtake the earlier queue in the waiting strategy.
    orders = tuple(
        replace(order, due=BASE_TIME.replace(hour=14)) if order.id == "O1005" else order
        for order in demo_orders()
    )
    wait = generate_candidates(
        baseline, failure(), demo_machines(), orders, strategies=("wait-recovery",)
    )[0]
    for machine in demo_machines():
        before = sorted(
            (op for op in baseline.operations if op.machine_id == machine.id),
            key=lambda op: (op.start, op.id),
        )
        after = sorted(
            (op for op in wait.schedule.operations if op.machine_id == machine.id),
            key=lambda op: (op.start, op.id),
        )
        assert [op.id for op in before] == [op.id for op in after]
