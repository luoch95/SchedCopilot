"""Trial endpoints persist a complete result while leaving the formal plan untouched."""

import sqlite3
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from sched_copilot.api import create_app
from sched_copilot.domain.models import TaskStatus
from sched_copilot.scenarios.demo import demo_schedule


def submit(client, quantity=100):
    snapshot = client.get("/api/sales/overview").json()
    start = datetime.fromisoformat(snapshot["snapshot_time"])
    response = client.post(
        "/api/sales/requests",
        json=dict(
            product_id="P-DEMO-001",
            quantity=quantity,
            earliest_start_at=start.isoformat(),
            requested_due_at=(start + timedelta(days=2)).isoformat(),
            reason="试排集成测试",
            submission_key=f"trial-{quantity}",
        ),
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_complete_json_saved_and_restored_after_restart_without_publishing(tmp_path, monkeypatch):
    path = tmp_path / "trial.sqlite3"
    app = create_app(path)

    def no_agent(*args, **kwargs):
        raise AssertionError("Independent trials must not call Agents")

    monkeypatch.setattr(app.state.workbench, "run_workflow", no_agent)
    with TestClient(app) as client:
        request = submit(client)
        before = client.get("/api/workbench").json()
        response = client.post(f"/api/sales/requests/{request['id']}/assessment")
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["summary"]["estimated_completion_at"]
        assert isinstance(result["summary"]["meets_due"], bool)
        assert result["details"]["operations"]
        inserted = [
            op
            for op in result["details"]["operations"]
            if op["order_id"] == result["details"]["inserted_order_id"]
        ]
        assert inserted
        assert all(
            op["display_name"] == f"{request['request_no']}-OP{op['sequence']}"
            and op["order_display_name"] == request["request_no"]
            for op in inserted
        )
        assert any(op["order_id"].startswith("URG-") for op in result["details"]["operations"])
        assert all("machine_id" in op and "mold_id" in op for op in result["details"]["operations"])
        assert client.get("/api/workbench").json() == before
        assert client.get("/api/sales/requests").json()[0]["assessment"] == result
        assert client.get("/api/sales/requests").json()[0]["assessment_stale"] is False
        for original in demo_schedule().operations:
            if original.status != TaskStatus.PLANNED:
                op = next(
                    o for o in result["details"]["operations"] if o["operation_id"] == original.id
                )
                assert op["start"] == original.start.isoformat()
                assert op["machine_id"] == original.machine_id
    with TestClient(create_app(path)) as restarted:
        assert restarted.get("/api/sales/requests").json()[0]["assessment"] == result
        assert restarted.get("/api/workbench").json() == before
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT assessment_json FROM insertion_requests").fetchone()[0]
        assert conn.execute("SELECT COUNT(*) FROM request_status_history").fetchone()[0] == 1
        assert conn.execute("SELECT status FROM approval_records").fetchone()[0] == "pending"


def test_failed_trial_does_not_save_fake_result(tmp_path):
    with TestClient(create_app(tmp_path / "failure.sqlite3")) as client:
        request = submit(client, 1000000)
        response = client.post(f"/api/sales/requests/{request['id']}/assessment")
        assert response.status_code == 409, response.text
        assert client.get("/api/sales/requests").json()[0]["assessment"] is None
        assert client.post("/api/sales/requests/missing/assessment").status_code == 404


def test_event_change_marks_saved_assessment_stale(tmp_path):
    with TestClient(create_app(tmp_path / "stale.sqlite3")) as client:
        request = submit(client)
        assert client.post(f"/api/sales/requests/{request['id']}/assessment").status_code == 200
        snapshot = client.get("/api/workbench").json()
        event = snapshot["event"]
        response = client.put(
            "/api/event",
            json=dict(
                event_revision=snapshot["event_revision"],
                baseline_fingerprint=snapshot["baseline"]["fingerprint"],
                machine_id=event["machine_id"],
                started_at=event["started_at"],
                recovered_at=event["recovered_at"],
                source="事件版本变化测试",
            ),
        )
        assert response.status_code == 200, response.text
        assert client.get("/api/sales/requests").json()[0]["assessment_stale"] is True


def test_changes_during_trial_do_not_overwrite_saved_result(tmp_path, monkeypatch):
    path = tmp_path / "concurrent.sqlite3"
    app = create_app(path)
    with TestClient(app) as client:
        request = submit(client)
        url = f"/api/sales/requests/{request['id']}/assessment"
        previous = client.post(url).json()
        repository = app.state.sales_requests.repository
        original_save = repository.save_assessment

        def changed(request_id, result):
            # Simulate an event committed by another session while calculation ran.
            with sqlite3.connect(path) as conn:
                conn.execute(
                    "INSERT INTO event_history (fingerprint,payload,recorded_at) "
                    "SELECT fingerprint,payload,recorded_at FROM event_history "
                    "ORDER BY revision DESC LIMIT 1"
                )
            original_save(request_id, result)

        monkeypatch.setattr(repository, "save_assessment", changed)
        response = client.post(url)
        assert response.status_code == 409, response.text
        record = client.get("/api/sales/requests").json()[0]
        assert record["assessment"] == previous
        assert record["assessment_stale"] is True


def test_production_resource_change_marks_old_result_stale(tmp_path):
    import json

    from sched_copilot.scenarios.production_demo import demo_production_inputs

    path = tmp_path / "resources.sqlite3"
    with TestClient(create_app(path)) as client:
        request = submit(client)
        assert client.post(f"/api/sales/requests/{request['id']}/assessment").status_code == 200
        with sqlite3.connect(path) as conn:
            conn.execute(
                "INSERT INTO production_inputs (id,payload) VALUES (1,?)",
                (json.dumps(demo_production_inputs()),),
            )
        assert client.get("/api/sales/requests").json()[0]["assessment_stale"] is True


def test_legacy_snapshot_labels_do_not_invalidate_existing_approval(tmp_path):
    import json

    path = tmp_path / "legacy-labels.sqlite3"
    with TestClient(create_app(path)) as client:
        request = submit(client)
        result = client.post(f"/api/sales/requests/{request['request_no']}/assessment").json()
        for op in result["details"]["operations"]:
            op.pop("display_name", None)
            op.pop("order_display_name", None)
        result.pop("request_no", None)
        with sqlite3.connect(path) as conn:
            conn.execute(
                "UPDATE insertion_requests SET assessment_json=? WHERE id=?",
                (json.dumps(result, ensure_ascii=False), request["id"]),
            )
        base = f"/api/sales/requests/{request['request_no']}"
        action = {
            "action": "approve",
            "reason": "确认风险",
            "operator_role": "leader",
            "assessment_id": result["assessment_id"],
        }
        approved = client.post(base + "/actions", json=action)
        assert approved.status_code == 200, approved.text
        with sqlite3.connect(path) as conn:
            evidence = conn.execute("SELECT assessment_json FROM insertion_requests").fetchone()[0]
    with TestClient(create_app(path)) as restarted:
        detail = restarted.get(base).json()
        inserted = next(
            op
            for op in detail["assessment"]["details"]["operations"]
            if op["order_id"] == result["details"]["inserted_order_id"]
        )
        assert inserted["display_name"] == f"{request['request_no']}-OP1"
        assert detail["approval"]["status"] == "approved"
        published = restarted.post(
            base + "/actions", json={**action, "action": "publish", "operator_role": "planner"}
        )
        assert published.status_code == 200, published.text
    with sqlite3.connect(path) as conn:
        assert (
            conn.execute("SELECT assessment_json FROM insertion_requests").fetchone()[0] == evidence
        )
