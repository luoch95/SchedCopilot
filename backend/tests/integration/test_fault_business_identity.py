from dataclasses import replace
from datetime import datetime, timedelta, timezone

from sched_copilot.domain.models import MachineFailure
from sched_copilot.infrastructure.sqlite_repository import DecisionStore
from sched_copilot.scenarios.demo import demo_schedule

UTC = timezone.utc


def failure(machine: str, started_at: datetime, source: str = "维修班组") -> MachineFailure:
    return MachineFailure(
        machine,
        started_at,
        started_at + timedelta(hours=1),
        source,
        started_at,
    )


def test_fault_business_code_counts_per_machine_and_resets_each_day(tmp_path):
    store = DecisionStore(tmp_path / "identity.sqlite3", demo_schedule())
    day_one = datetime(2026, 10, 26, 8, tzinfo=UTC)

    store.record_event(failure("M1", day_one))
    first = store.snapshot()[1]
    store.record_event(failure("M1", day_one + timedelta(hours=1)))
    second = store.snapshot()[1]
    store.record_event(failure("M2", day_one + timedelta(hours=1)))
    other_machine = store.snapshot()[1]
    store.record_event(failure("M1", day_one + timedelta(days=1)))
    next_day = store.snapshot()[1]

    assert first.fault_business_code == "M1-GZ01"
    assert second.fault_business_code == "M1-GZ02"
    assert other_machine.fault_business_code == "M2-GZ01"
    assert next_day.fault_business_code == "M1-GZ01"


def test_same_fault_revision_reuses_identity_and_process_stage_does_not_change_it(tmp_path):
    store = DecisionStore(tmp_path / "revision.sqlite3", demo_schedule())
    started_at = datetime(2026, 10, 26, 8, tzinfo=UTC)

    store.record_event(failure("M1", started_at, "第一次记录"))
    first = store.snapshot()[1]
    store.record_event(failure("M1", started_at, "修订后的记录"))
    revised = store.snapshot()[1]

    assert revised.fault_event_id == first.fault_event_id
    assert revised.fault_business_code == first.fault_business_code

    store.record_event(replace(revised, fault_process_stage="002"))
    progressed = store.snapshot()[1]
    assert progressed.fault_event_id == first.fault_event_id
    assert progressed.fault_business_code == first.fault_business_code
