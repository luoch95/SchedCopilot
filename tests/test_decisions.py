from dataclasses import replace
from datetime import timedelta

import pytest

from sched_copilot.domain import MachineFailure, digest
from sched_copilot.scenario import EVENT_TIME, demo_machines, demo_orders, demo_schedule
from sched_copilot.scheduling import generate_candidates
from sched_copilot.storage import DecisionStore


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
