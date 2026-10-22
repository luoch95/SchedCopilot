from dataclasses import replace
from datetime import timedelta

import pytest

from sched_copilot.domain.models import MachineFailure, digest
from sched_copilot.domain.scheduling import generate_candidates
from sched_copilot.infrastructure.sqlite_repository import DecisionStore
from sched_copilot.scenarios.demo import EVENT_TIME, demo_machines, demo_orders, demo_schedule


@pytest.fixture
def context(tmp_path):
    event = MachineFailure("M1", EVENT_TIME, EVENT_TIME + timedelta(hours=4), "test", EVENT_TIME)
    baseline = demo_schedule()
    store = DecisionStore(tmp_path / "decisions.sqlite3", baseline)
    store.record_event(event)
    candidates = generate_candidates(
        baseline, event, demo_machines(), demo_orders(), event_revision=store.active_event()[1]
    )
    return store, event, candidates


def test_reject_keeps_current_plan_and_audits_reason(context):
    store, event, candidates = context
    baseline = store.current()
    result = store.decide(candidates[0], event, demo_machines(), "reject", "待维修确认", "r1")
    assert result == baseline == store.current()
    assert store.history()[0]["reason"] == "待维修确认"


def test_publish_persists_and_duplicate_request_is_idempotent(context):
    store, event, candidates = context
    candidate = candidates[1]
    result = store.decide(candidate, event, demo_machines(), "publish", "交期优先", "p1")
    duplicate = store.decide(candidate, event, demo_machines(), "publish", "交期优先", "p1")
    assert result == duplicate == store.current()
    assert result.version == 2
    metadata = store.plan_metadata(2)
    assert metadata["version_summary"] == "因设备 M1 故障调整排产计划。"
    assert metadata["published_by"] == "planner_01"
    assert metadata["published_at"]
    assert [row["version"] for row in metadata["history"]] == [2, 1]
    assert metadata["history"][0]["details"] == ["交期优先"]
    assert metadata["history"][1]["published_at"] is None
    assert store.plan_metadata(1)["version_summary"] == "初始演示计划"
    assert len(store.history()) == 1


def test_stale_candidate_cannot_overwrite_new_plan(context):
    store, event, candidates = context
    store.decide(candidates[0], event, demo_machines(), "publish", "等待维修", "p1")
    with pytest.raises(ValueError, match="计划版本"):
        store.decide(candidates[1], event, demo_machines(), "publish", "转机", "p2")
    assert store.current() == candidates[0].schedule


def test_event_update_invalidates_candidate(context):
    store, event, candidates = context
    store.record_event(replace(event, recovered_at=event.recovered_at + timedelta(hours=1)))
    with pytest.raises(ValueError, match="事件已变化"):
        store.decide(candidates[0], event, demo_machines(), "publish", "确认", "p1")


def test_tampered_candidate_fails_constraint_check(context):
    store, event, candidates = context
    candidate = candidates[0]
    tasks = list(candidate.schedule.operations)
    tasks[0] = replace(tasks[0], machine_id="M3")
    tampered = replace(candidate, schedule=replace(candidate.schedule, operations=tuple(tasks)))
    with pytest.raises(ValueError, match="发布校验"):
        store.decide(tampered, event, demo_machines(), "publish", "确认", "p1")
    assert store.current().version == 1


def test_idempotency_key_cannot_be_reused_for_other_action(context):
    store, event, candidates = context
    store.decide(candidates[0], event, demo_machines(), "reject", "拒绝", "key")
    with pytest.raises(ValueError, match="请求 ID"):
        store.decide(candidates[0], event, demo_machines(), "publish", "接受", "key")


def test_event_fingerprint_must_match_supplied_event(context):
    store, event, candidates = context
    tampered = replace(candidates[0], event_fingerprint=digest(demo_schedule()))
    with pytest.raises(ValueError, match="事件已变化"):
        store.decide(tampered, event, demo_machines(), "publish", "确认", "p1")


def test_event_changed_back_still_invalidates_old_candidates(context):
    store, event, candidates = context
    store.record_event(replace(event, recovered_at=event.recovered_at + timedelta(hours=1)))
    store.record_event(event)
    assert store.active_event()[1] == 3
    with pytest.raises(ValueError, match="事件版本"):
        store.decide(candidates[0], event, demo_machines(), "publish", "确认", "p1")
    assert store.current().version == 1


def test_identical_save_does_not_increment_event_revision(context):
    store, event, _ = context
    assert store.record_event(event, expected_revision=1) == 1
    assert store.active_event() == (event, 1)


def test_stale_editor_cannot_overwrite_another_event(context):
    store, event, _ = context
    newer = replace(event, recovered_at=event.recovered_at + timedelta(hours=1))
    store.record_event(newer, expected_revision=1)
    with pytest.raises(ValueError, match="其他页面"):
        store.record_event(event, expected_revision=1)
    assert store.active_event() == (newer, 2)


def test_legacy_database_event_is_migrated_once(tmp_path):
    import json
    import sqlite3
    from dataclasses import asdict

    event = MachineFailure("M1", EVENT_TIME, EVENT_TIME + timedelta(hours=4), "old", EVENT_TIME)
    path = tmp_path / "legacy.sqlite3"
    with sqlite3.connect(path) as conn:
        conn.execute(
            "CREATE TABLE current_event (id INTEGER PRIMARY KEY, fingerprint TEXT, payload TEXT)"
        )
        conn.execute(
            "INSERT INTO current_event VALUES (1, ?, ?)",
            (digest(event), json.dumps(asdict(event), default=str)),
        )
    store = DecisionStore(path, demo_schedule())
    assert store.active_event() == (event, 1)
    reopened = DecisionStore(path, demo_schedule())
    assert reopened.active_event() == (event, 1)


def test_recovery_appends_event_preserves_plan_and_rejects_old_candidate(context):
    store, event, candidates = context
    store.record_event(replace(event, started_at=EVENT_TIME - timedelta(hours=1)))
    revision = recover(store, event)
    assert revision == 3
    assert store.active_event() == (event, 3)
    assert store.current() == demo_schedule()
    with pytest.raises(ValueError, match="事件版本"):
        store.decide(candidates[0], event, demo_machines(), "publish", "旧方案", "old")
    assert recover(store, event) == 3


def test_recovery_preserves_published_plan_and_decision_history(context):
    store, event, candidates = context
    store.decide(candidates[1], event, demo_machines(), "publish", "接受转机", "published")
    published, history = store.current(), store.history()
    store.record_event(replace(event, started_at=EVENT_TIME - timedelta(hours=1)))
    recover(store, event)
    assert store.current() == published
    assert store.history() == history


def test_publication_rejects_plan_inside_another_saved_failure_window(tmp_path):
    baseline = demo_schedule()
    store = DecisionStore(tmp_path / "multiple-failures.sqlite3", baseline)
    m3 = MachineFailure("M3", EVENT_TIME, EVENT_TIME + timedelta(hours=4), "M3停机", EVENT_TIME)
    m2 = MachineFailure("M2", EVENT_TIME, EVENT_TIME + timedelta(hours=2), "M2停机", EVENT_TIME)
    store.record_event(m3)
    store.record_event(m2, expected_revision=1)
    windows = store.failure_windows()
    assert {event.machine_id for event in windows} == {"M2", "M3"}

    candidates = generate_candidates(
        baseline,
        m2,
        demo_machines(),
        demo_orders(),
        event_revision=2,
        additional_failures=tuple(event for event in windows if event != m2),
    )
    candidate = candidates[1]
    op2 = next(op for op in candidate.schedule.operations if op.id == "O1002-OP2")
    assert not (op2.machine_id == "M3" and op2.start < m3.recovered_at and op2.end > m3.started_at)
    conflict = replace(
        candidate,
        schedule=replace(
            candidate.schedule,
            operations=tuple(
                replace(op, machine_id="M3", start=EVENT_TIME + timedelta(hours=1))
                if op.id == "O1002-OP2"
                else op
                for op in candidate.schedule.operations
            ),
        ),
    )
    with pytest.raises(ValueError, match="发布校验失败"):
        store.decide(conflict, m2, demo_machines(), "publish", "故障冲突", "blocked")


def test_recovery_uses_example_when_all_saved_events_are_invalid(tmp_path):
    store = DecisionStore(tmp_path / "recover.sqlite3", demo_schedule())
    example = MachineFailure("M1", EVENT_TIME, EVENT_TIME + timedelta(hours=4), "示例", EVENT_TIME)
    store.record_event(replace(example, started_at=EVENT_TIME - timedelta(hours=1)))
    assert recover(store, example) == 2
    assert store.active_event()[0] == example


def recover(store, example):
    from sched_copilot.application.contracts import SnapshotVersion
    from sched_copilot.application.workbench import WorkbenchService

    service = WorkbenchService(
        store, demo_machines(), demo_orders(), EVENT_TIME, example, lambda *args, **kwargs: {}
    )
    baseline, _, revision = store.snapshot()
    return service.recover_event(SnapshotVersion(revision, baseline.fingerprint)).event_revision
