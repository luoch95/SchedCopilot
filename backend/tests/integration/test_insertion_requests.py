"""Insertion submission persistence, idempotency and rollback integration tests."""

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


def test_submit_persists_all_three_tables_and_survives_app_restart(setup):
    path, app, client, payload = setup
    baseline = client.get("/api/workbench").json()
    response = client.post("/api/sales/requests", json=payload)
    assert response.status_code == 201, response.text
    record = response.json()
    assert record["status"] == "pending_approval"
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
