"""Insertion submission persistence, idempotency and rollback integration tests."""

import json
import sqlite3
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from sched_copilot.api import create_app
from sched_copilot.infrastructure.models.requests import ApprovalRecord


@pytest.fixture
def setup(tmp_path):
    path = tmp_path / "requests.sqlite3"
    app = create_app(path)
    with TestClient(app) as client:
        snapshot = client.get("/api/sales/overview").json()
        start = datetime.fromisoformat(snapshot["snapshot_time"])
        payload = {
            "product_id": "P-DEMO-001",
            "quantity": 1001,
            "earliest_start_at": start.isoformat(),
            "requested_due_at": (start + timedelta(days=1)).isoformat(),
            "reason": "客户紧急补货",
            "submission_key": "submit-test-1",
        }
        yield path, app, client, payload


def table_counts(path):
    with sqlite3.connect(path) as conn:
        return [
            conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("insertion_requests", "approval_records", "request_status_history")
        ]


def test_insertion_stream_reports_real_roles_then_persistence(setup):
    _, _, client, payload = setup
    before = client.get("/api/workbench").json()
    draft = client.post("/api/sales/requests", json={**payload, "draft_only": True}).json()
    response = client.post(
        f"/api/sales/requests/{draft['request_no']}/assessment",
        json={},
        headers={"Accept": "application/x-ndjson"},
    )
    assert response.status_code == 200
    assert "application/x-ndjson" in response.headers["content-type"]
    events = [json.loads(line) for line in response.iter_lines() if line]
    events = [event for event in events if event["type"] != "heartbeat"]
    roles = ["validation", "scheduling", "evaluation", "explanation", "saving"]
    assert [(e["type"], e["agent"]) for e in events[:-1]] == [
        (kind, role)
        for role in roles
        for kind in ("insertion_stage_started", "insertion_stage_completed")
    ]
    assert events[-1]["type"] == "result"
    assert events[-1]["data"]["assessment_id"]
    record = client.get(f"/api/sales/requests/{draft['request_no']}").json()
    assert record["status"] == "draft"
    assert record["assessment"] == events[-1]["data"]
    assert client.get("/api/workbench").json() == before


@pytest.mark.parametrize("failed_stage", ["scheduling", "saving"])
def test_insertion_stream_stops_at_failure_without_false_completion(
    setup, monkeypatch, failed_stage
):
    from sched_copilot.domain.errors import RuleViolation

    _, app, client, payload = setup
    draft = client.post("/api/sales/requests", json={**payload, "draft_only": True}).json()

    def fail(*args, **kwargs):
        raise RuleViolation("当前条件无法继续")

    if failed_stage == "saving":
        monkeypatch.setattr(app.state.sales_requests.repository, "save_assessment", fail)
    else:
        monkeypatch.setattr(
            app.state.sales_requests.workflow_runner.scheduling, "run_insertion", fail
        )
    response = client.post(
        f"/api/sales/requests/{draft['request_no']}/assessment",
        json={},
        headers={"Accept": "application/x-ndjson"},
    )
    events = [json.loads(line) for line in response.iter_lines() if line]
    assert {"type": "insertion_stage_failed", "agent": failed_stage} in events
    assert not any(
        e["type"] == "insertion_stage_completed" and e["agent"] == failed_stage for e in events
    )
    assert events[-1]["type"] == "error"
    assert events[-1]["detail"] == "当前条件无法继续"
    assert not any(e["type"] == "result" for e in events)
    assert client.get(f"/api/sales/requests/{draft['request_no']}").json()["assessment"] is None


def test_draft_assessment_precedes_explicit_submission(setup):
    path, _, client, payload = setup
    baseline = client.get("/api/workbench").json()
    draft_payload = {**payload, "draft_only": True}
    draft = client.post("/api/sales/requests", json=draft_payload).json()
    assert draft["status"] == "draft"
    assert draft["approval"] is None
    assert table_counts(path) == [1, 0, 0]
    assert client.post("/api/sales/requests", json=draft_payload).json() == draft
    url = f"/api/sales/requests/{draft['request_no']}"
    action = {"action": "submit", "operator_role": "sales", "reason": "评估后提交"}
    assert client.post(url + "/actions", json=action).status_code == 409
    assessment = client.post(url + "/assessment").json()
    assert [step["agent"] for step in assessment["workflow"]["trace"]] == [
        "validation",
        "scheduling",
        "evaluation",
        "explanation",
    ]
    assert client.get(url).json()["status"] == "draft"
    assert table_counts(path) == [1, 0, 0]
    assert client.get("/api/sales/requests?status=pending_approval").json() == []
    action["assessment_id"] = assessment["assessment_id"]
    assert (
        client.post(url + "/actions", json={**action, "operator_role": "leader"}).status_code == 409
    )
    assert client.post(url + "/actions", json={**action, "assessment_id": "old"}).status_code == 409
    submitted = client.post(url + "/actions", json=action)
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["status"] == "pending_approval"
    assert submitted.json()["assessment"] == assessment
    assert table_counts(path) == [1, 1, 1]
    assert client.post(url + "/actions", json=action).json() == submitted.json()
    assert table_counts(path) == [1, 1, 1]
    assert client.get("/api/workbench").json() == baseline


def test_draft_submission_rejects_stale_resources(setup):
    path, _, client, payload = setup
    draft = client.post("/api/sales/requests", json={**payload, "draft_only": True}).json()
    url = f"/api/sales/requests/{draft['request_no']}"
    assessment = client.post(url + "/assessment").json()
    with sqlite3.connect(path) as connection:
        connection.execute(
            "INSERT INTO production_inputs(id,payload) VALUES(1,'{}') "
            "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload"
        )
    response = client.post(
        url + "/actions",
        json={
            "action": "submit",
            "operator_role": "sales",
            "reason": "提交审批",
            "assessment_id": assessment["assessment_id"],
        },
    )
    assert response.status_code == 409, response.text
    assert client.get(url).json()["status"] == "draft"
    assert table_counts(path) == [1, 0, 0]


def test_submit_persists_all_three_tables_and_survives_app_restart(setup):
    path, app, client, payload = setup
    baseline = client.get("/api/workbench").json()
    response = client.post("/api/sales/requests", json=payload)
    assert response.status_code == 201, response.text
    record = response.json()
    assert record["status"] == "pending_approval"
    assert record["assigned_planner"] == "planner_01"
    assert record["applicant_id"] == "sales_01"
    assert record["estimate"]["planned_minutes"] == 414
    assert datetime.fromisoformat(record["earliest_start_at"]) == datetime.fromisoformat(
        payload["earliest_start_at"]
    )
    assert table_counts(path) == [1, 1, 1]
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT status FROM approval_records").fetchone()[0] == "pending"
        assert conn.execute(
            "SELECT from_status, to_status FROM request_status_history"
        ).fetchone() == ("draft", "pending_approval")
        assert conn.execute("SELECT assessment_json FROM insertion_requests").fetchone()[0] is None
    assert client.get("/api/sales/requests").json() == [record]
    with TestClient(create_app(path)) as restarted:
        assert restarted.get("/api/sales/requests").json() == [record]
        assert restarted.get("/api/workbench").json() == baseline
    assert not any(field in response.text for field in ('"machine_id"', '"operations"'))


def test_retry_is_idempotent_and_rejects_changed_content(setup):
    path, _, client, payload = setup
    first = client.post("/api/sales/requests", json=payload)
    second = client.post("/api/sales/requests", json=payload)
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    assert table_counts(path) == [1, 1, 1]
    assert client.post("/api/sales/requests", json={**payload, "quantity": 1002}).status_code == 409
    assert table_counts(path) == [1, 1, 1]


def test_approval_write_failure_rolls_back_request_and_history(setup):
    path, app, _, payload = setup

    def fail(*args):
        raise RuntimeError("simulate failed approval write")

    event.listen(ApprovalRecord, "before_insert", fail)
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            assert client.post("/api/sales/requests", json=payload).status_code == 500
    finally:
        event.remove(ApprovalRecord, "before_insert", fail)
    assert table_counts(path) == [0, 0, 0]


@pytest.mark.parametrize(
    "changes,expected_status",
    [
        ({"quantity": 0}, 422),
        ({"quantity": True}, 422),
        ({"draft_only": "true"}, 422),
        ({"product_id": "unknown"}, 409),
        ({"reason": " "}, 422),
        ({"requested_due_at": "2020-01-01T00:00:00+08:00"}, 422),
        ({"earliest_start_at": "2020-01-01T00:00:00+08:00"}, 409),
        ({"status": "approved"}, 422),
        ({"estimate": {"planned_minutes": 1}}, 422),
        ({"earliest_start_at": "2026-10-19T12:00:00"}, 422),
    ],
)
def test_invalid_input_never_writes_partial_rows(setup, changes, expected_status):
    path, _, client, payload = setup
    assert (
        client.post("/api/sales/requests", json={**payload, **changes}).status_code
        == expected_status
    )
    assert table_counts(path) == [0, 0, 0]


def test_daily_number_survives_restart_and_is_used_by_detail_and_actions(setup):
    import re
    from uuid import UUID

    path, _, client, payload = setup
    first = client.post("/api/sales/requests", json=payload).json()
    UUID(first["id"])
    assert re.fullmatch(r"URG-\d{8}-001", first["request_no"])
    assert client.get(f"/api/sales/requests/{first['request_no']}").json() == first
    with TestClient(create_app(path)) as restarted:
        second = restarted.post(
            "/api/sales/requests", json={**payload, "submission_key": "second"}
        ).json()
        assert second["request_no"] == first["request_no"][:-3] + "002"
        assert (
            restarted.post("/api/sales/requests", json=payload).json()["request_no"]
            == first["request_no"]
        )
        trial = restarted.post(f"/api/sales/requests/{second['request_no']}/assessment")
        assert trial.status_code == 200, trial.text
        assert trial.json()["request_no"] == second["request_no"]
        for action, role in [("approve", "leader"), ("publish", "planner")]:
            response = restarted.post(
                f"/api/sales/requests/{second['request_no']}/actions",
                json={
                    "action": action,
                    "operator_role": role,
                    "reason": "单号闭环测试",
                    "assessment_id": trial.json()["assessment_id"],
                },
            )
            assert response.status_code == 200, response.text
            assert response.json()["request_no"] == second["request_no"]
        assert restarted.get("/api/sales/requests/URG-00000000-000").status_code == 404
    with sqlite3.connect(path) as conn:
        assert (
            conn.execute(
                "SELECT request_no FROM insertion_requests WHERE id=?", (first["id"],)
            ).fetchone()[0]
            == first["request_no"]
        )


def test_parallel_submissions_allocate_distinct_numbers(setup):
    from concurrent.futures import ThreadPoolExecutor

    _, _, client, payload = setup

    def submit(index):
        response = client.post(
            "/api/sales/requests", json={**payload, "submission_key": f"parallel-{index}"}
        )
        assert response.status_code == 201, response.text
        return response.json()["request_no"]

    with ThreadPoolExecutor(max_workers=4) as pool:
        numbers = list(pool.map(submit, range(8)))
    assert len(set(numbers)) == 8
    assert sorted(int(number.rsplit("-", 1)[1]) for number in numbers) == list(range(1, 9))


def test_legacy_numbers_migrate_once_without_changing_uuid_relations(setup):
    from sched_copilot.infrastructure.insertion_repository import InsertionStore

    path, _, client, payload = setup
    first = client.post("/api/sales/requests", json=payload).json()
    with sqlite3.connect(path) as conn:
        conn.execute(
            "UPDATE insertion_requests SET request_no=? WHERE id=?",
            (f"URG-{first['created_at'][:10].replace('-', '')}-{first['id'].upper()}", first["id"]),
        )
    store = InsertionStore(path)
    migrated = store.get(first["id"])
    assert migrated["id"] == first["id"]
    assert migrated["request_no"].endswith("-002")
    assert table_counts(path) == [1, 1, 1]
    assert list((path.parent / "backups").glob("*.sqlite3"))
    assert InsertionStore(path).get(first["id"])["request_no"] == migrated["request_no"]


def test_numbering_uses_beijing_date_and_resets_per_day():
    from sched_copilot.infrastructure.insertion_repository import InsertionStore

    assert InsertionStore._number_day(datetime.fromisoformat("2026-10-20T15:59:00")) == "20261020"
    assert InsertionStore._number_day(datetime.fromisoformat("2026-10-20T16:00:00")) == "20261021"


def test_sequence_keeps_high_watermark_after_request_deletion_and_resets_daily(setup):
    from sched_copilot.infrastructure.insertion_repository import InsertionStore

    path, _, client, payload = setup
    first = client.post("/api/sales/requests", json=payload).json()
    with sqlite3.connect(path) as conn:
        conn.execute("DELETE FROM request_status_history")
        conn.execute("DELETE FROM approval_records")
        conn.execute("DELETE FROM insertion_requests")
    store = InsertionStore(path)
    with store.sessions() as session:
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        day = first["request_no"].split("-")[1]
        assert store._next_number(session, day).endswith("-002")
        assert store._next_number(session, "20990101") == "URG-20990101-001"
        session.rollback()
    second = client.post(
        "/api/sales/requests", json={**payload, "submission_key": "after-delete"}
    ).json()
    assert second["request_no"].endswith("-002")


def test_planner_assignment_filter_and_action_response(setup):
    path, _, client, payload = setup
    first = client.post("/api/sales/requests", json=payload).json()
    second = client.post(
        "/api/sales/requests", json={**payload, "submission_key": "planner-two"}
    ).json()
    with sqlite3.connect(path) as conn:
        conn.execute(
            "UPDATE insertion_requests SET assigned_planner=? WHERE id=?",
            ("planner_02", second["id"]),
        )
        assert (
            conn.execute(
                "SELECT assigned_planner FROM insertion_requests WHERE id=?", (first["id"],)
            ).fetchone()[0]
            == "planner_01"
        )
    for planner, expected in [("planner_01", first), ("planner_02", second)]:
        response = client.get("/api/sales/requests", params={"assigned_planner": planner})
        assert response.status_code == 200
        assert [r["id"] for r in response.json()] == [expected["id"]]
        assert response.json()[0]["assigned_planner"] == planner
    assert client.get("/api/sales/requests?assigned_planner=unknown").json() == []
    assert len(client.get("/api/sales/requests").json()) == 2
    assert (
        client.get("/api/sales/requests?assigned_planner=planner_01&status=approved").json() == []
    )
    detail = client.get(f"/api/sales/requests/{first['request_no']}").json()
    assert detail["assigned_planner"] == "planner_01"
    action = client.post(
        f"/api/sales/requests/{first['request_no']}/actions",
        json={"action": "reject", "reason": "test", "operator_role": "leader"},
    )
    assert action.status_code == 200, action.text
    assert action.json()["assigned_planner"] == "planner_01"
    assert (
        client.get("/api/sales/requests?assigned_planner=planner_01&status=pending_approval").json()
        == []
    )
    with TestClient(create_app(path)) as restarted:
        assert (
            restarted.get(f"/api/sales/requests/{second['request_no']}").json()["assigned_planner"]
            == "planner_02"
        )


def test_legacy_database_backfills_planner_without_losing_request_data(setup):
    from sched_copilot.infrastructure.insertion_repository import InsertionStore

    path, _, client, payload = setup
    first = client.post("/api/sales/requests", json=payload).json()
    store = InsertionStore(path)
    before = store.get(first["request_no"])
    store.engine.dispose()
    with sqlite3.connect(path) as conn:
        conn.execute("DROP INDEX ix_insertion_requests_assigned_planner")
        conn.execute("ALTER TABLE insertion_requests DROP COLUMN assigned_planner")
    migrated = InsertionStore(path)
    assert migrated.get(first["request_no"]) == before
    assert table_counts(path) == [1, 1, 1]
    backups = list((path.parent / "backups").glob("*.sqlite3"))
    assert backups
    with sqlite3.connect(backups[-1]) as conn:
        assert "assigned_planner" not in {
            row[1] for row in conn.execute("PRAGMA table_info(insertion_requests)")
        }
    migrated.engine.dispose()
    assert InsertionStore(path).get(first["request_no"]) == before
    assert len(list((path.parent / "backups").glob("*.sqlite3"))) == len(backups)


def test_applicant_name_legacy_migration_preserves_records_and_does_not_infer_identity(setup):
    from sched_copilot.infrastructure.insertion_repository import InsertionStore

    path, _, client, payload = setup
    first = client.post("/api/sales/requests", json=payload).json()
    assert first["applicant_name"] is None
    store = InsertionStore(path)
    before = store.get(first["request_no"])
    store.engine.dispose()
    with sqlite3.connect(path) as conn:
        conn.execute("ALTER TABLE insertion_requests DROP COLUMN applicant_name")
    migrated = InsertionStore(path)
    assert migrated.get(first["request_no"]) == before
    assert table_counts(path) == [1, 1, 1]
    backups = list((path.parent / "backups").glob("*.sqlite3"))
    assert backups
    assert any(
        "applicant_name"
        not in {
            r[1] for r in sqlite3.connect(backup).execute("PRAGMA table_info(insertion_requests)")
        }
        for backup in backups
    )
    migrated.engine.dispose()
    assert InsertionStore(path).get(first["request_no"]) == before
    assert len(list((path.parent / "backups").glob("*.sqlite3"))) == len(backups)


def test_client_cannot_claim_an_authenticated_applicant_name(setup):
    _, _, client, payload = setup
    response = client.post("/api/sales/requests", json={**payload, "applicant_name": "伪造姓名"})
    assert response.status_code == 422


def test_client_cannot_override_demo_applicant_id(setup):
    _, _, client, payload = setup
    response = client.post("/api/sales/requests", json={**payload, "applicant_id": "sales_99"})
    assert response.status_code == 422


def test_applicant_id_migration_preserves_unknown_legacy_identity(setup):
    from sched_copilot.infrastructure.insertion_repository import InsertionStore

    path, app, client, payload = setup
    record = client.post("/api/sales/requests", json=payload).json()
    app.state.sales_requests.repository.engine.dispose()
    with sqlite3.connect(path) as connection:
        connection.execute("ALTER TABLE insertion_requests DROP COLUMN applicant_id")
    store = InsertionStore(path)
    migrated = store.get(record["id"])
    assert migrated["applicant_id"] is None
    assert migrated["request_no"] == record["request_no"]
    assert migrated["status_history"] == record["status_history"]
    assert migrated["approval"] == record["approval"]
    store.engine.dispose()


def test_applicant_name_snapshot_survives_restart_and_retry(setup):
    path, app, client, payload = setup
    overview = client.get("/api/sales/overview").json()
    values = dict(payload)
    for field in ("earliest_start_at", "requested_due_at"):
        values[field] = datetime.fromisoformat(values[field])
    values.update(
        plan_version=overview["plan_version"],
        plan_fingerprint=overview["plan_fingerprint"],
        snapshot_time=datetime.fromisoformat(overview["snapshot_time"]),
    )
    record = app.state.sales_requests.submit(**values, applicant_name="陈明")
    assert record["applicant_name"] == "陈明"
    assert app.state.sales_requests.submit(**values)["applicant_name"] == "陈明"
    with TestClient(create_app(path)) as restarted:
        assert (
            restarted.get(f"/api/sales/requests/{record['request_no']}").json()["applicant_name"]
            == "陈明"
        )
