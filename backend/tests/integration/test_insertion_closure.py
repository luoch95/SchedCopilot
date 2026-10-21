"""Real HTTP and SQLite closure, including stale approvals and rollback."""

import json
import sqlite3
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from sched_copilot.api import create_app


def submit(client, key="closure", product="P-DEMO-001"):
    start = datetime.fromisoformat(client.get("/api/sales/overview").json()["snapshot_time"])
    response = client.post(
        "/api/sales/requests",
        json=dict(
            product_id=product,
            quantity=100,
            earliest_start_at=start.isoformat(),
            requested_due_at=(start + timedelta(days=3)).isoformat(),
            reason="闭环验收",
            submission_key=key,
        ),
    )
    assert response.status_code == 201, response.text
    return response.json()


def assess(client, record):
    response = client.post(f"/api/sales/requests/{record['id']}/assessment")
    assert response.status_code == 200, response.text
    return response.json()


def act(client, record, action, result=None, role=None):
    return client.post(
        f"/api/sales/requests/{record['id']}/actions",
        json=dict(
            action=action,
            reason="接受交期风险，确认本次操作",
            assessment_id=result["assessment_id"] if result else None,
            operator_role=role or ("planner" if action == "publish" else "leader"),
        ),
    )


def test_full_closure_survives_restart_and_supports_later_trials(tmp_path):
    path = tmp_path / "closure.sqlite3"
    with TestClient(create_app(path)) as client:
        before = client.get("/api/workbench").json()
        record = submit(client)
        result = assess(client, record)
        assert [s["agent"] for s in result["workflow"]["trace"]] == [
            "validation",
            "scheduling",
            "evaluation",
            "explanation",
        ]
        assert all(s["status"] == "success" for s in result["workflow"]["trace"])
        assert result["workflow"]["evaluation"] == result["summary"]
        assert act(client, record, "approve", result).status_code == 200
        assert client.get("/api/workbench").json() == before
        assert client.get("/api/sales/requests?status=pending_approval").json() == []
        published = act(client, record, "publish", result)
        assert published.status_code == 200, published.text
        assert published.json()["status"] == "published"
        assert [h["to_status"] for h in published.json()["status_history"]] == [
            "pending_approval",
            "approved",
            "published",
        ]
        after = client.get("/api/workbench").json()
        assert after["baseline"]["version"] == before["baseline"]["version"] + 1
        metadata = after["plan_publication"]
        assert metadata["version"] == 2
        assert metadata["published_by"] == "planner_01"
        assert datetime.fromisoformat(metadata["published_at"])
        assert metadata["version_summary"] == (
            f"发布插单申请 {record['request_no']}，涉及 1 个新增工序和 "
            f"{result['summary']['affected_order_count']} 个原订单调整。"
        )
        inserted = next(
            op for op in after["baseline"]["operations"] if op["order_id"] == f"URG-{record['id']}"
        )
        assert inserted["display_name"] == f"{record['request_no']}-OP1"
        assert inserted["order_display_name"] == record["request_no"]
        order = next(o for o in after["orders"] if o["id"] == inserted["order_id"])
        assert order["display_name"] == record["request_no"]
        overview = client.get("/api/sales/overview").json()
        assert (
            next(o for o in overview["orders"] if o["id"] == inserted["order_id"])["display_name"]
            == record["request_no"]
        )
        with sqlite3.connect(path) as conn:
            payload = json.loads(conn.execute("SELECT payload FROM current_plan").fetchone()[0])
            stored = next(op for op in payload["operations"] if op["id"] == inserted["id"])
            assert stored["display_name"] == inserted["display_name"]
            evidence = json.loads(conn.execute("SELECT evidence FROM decisions").fetchone()[0])
            assert evidence["version_summary"] == metadata["version_summary"]
        assert len(after["orders"]) == len(before["orders"]) + 1
        assert any(o["id"] == f"URG-{record['id']}" for o in after["orders"])
        assert act(client, record, "publish", result).status_code == 200
        assert client.get("/api/workbench").json() == after
        assert client.post(f"/api/sales/requests/{record['id']}/assessment").status_code == 409
    with TestClient(create_app(path)) as client:
        assert client.get("/api/workbench").json() == after
        saved = client.get("/api/sales/requests").json()[0]
        assert saved["status"] == "published" and saved["assessment_stale"] is False
        assert saved["assessment"] == result
        second = submit(client, "second", "P-DEMO-003")
        second_result = assess(client, second)
        previous_op = next(
            o
            for o in second_result["details"]["operations"]
            if o["order_id"] == inserted["order_id"]
        )
        assert previous_op["order_display_name"] == record["request_no"]
        assert previous_op["display_name"] == f"{record['request_no']}-OP1"
        assert len(second_result["summary"]["order_impacts"]) == len(after["orders"])
        assert act(client, second, "approve", second_result).status_code == 200
        response = act(client, second, "publish", second_result)
        assert response.status_code == 200, response.text
        assert client.get("/api/workbench").json()["baseline"]["version"] == 3
        # Existing fault simulation still works with added orders and persisted mold resources.
        snapshot = client.get("/api/workbench").json()
        version = dict(
            event_revision=snapshot["event_revision"],
            baseline_fingerprint=snapshot["baseline"]["fingerprint"],
        )
        simulated = client.post("/api/simulations", json=version)
        assert simulated.status_code == 200, simulated.text
        for candidate in simulated.json()["candidates"]:
            op = next(
                op
                for op in candidate["schedule"]["operations"]
                if op["order_id"] == f"URG-{record['id']}"
            )
            assert op["display_name"] == f"{record['request_no']}-OP1"
        generated = client.post("/api/workflow", json={**version, "intent": "generate_candidates"})
        assert generated.status_code == 200, generated.text
        assert generated.json()["workflow"]["status"] == "completed", generated.text
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM decisions").fetchone()[0] == 2
        assert conn.execute("SELECT COUNT(*) FROM request_status_history").fetchone()[0] == 6


def test_rejection_and_role_guards(tmp_path):
    with TestClient(create_app(tmp_path / "reject.sqlite3")) as client:
        record = submit(client)
        assert act(client, record, "approve").status_code == 409
        assert act(client, record, "publish").status_code == 409
        assert act(client, record, "reject", role="sales").status_code == 409
        assert act(client, record, "reject").status_code == 200
        assert act(client, record, "reject").status_code == 200
        rows = client.get("/api/sales/requests").json()
        assert rows[0]["status"] == "rejected"
        assert len(rows[0]["status_history"]) == 2
        assert client.post(f"/api/sales/requests/{record['id']}/assessment").status_code == 409


def test_reassessment_invalidates_approval_and_old_browser_actions(tmp_path):
    with TestClient(create_app(tmp_path / "reapprove.sqlite3")) as client:
        record = submit(client)
        first = assess(client, record)
        assert act(client, record, "approve", first).status_code == 200
        second = assess(client, record)
        assert first["assessment_id"] != second["assessment_id"]
        assert act(client, record, "publish", first).status_code == 409
        assert act(client, record, "approve", first).status_code == 409
        assert act(client, record, "reject", first).status_code == 409
        saved = client.get("/api/sales/requests").json()[0]
        assert saved["status"] == "pending_approval"
        assert saved["approval"]["status"] == "pending"
        assert act(client, record, "approve", second).status_code == 200
        response = act(client, record, "publish", second)
        assert response.status_code == 200, response.text


@pytest.mark.parametrize("change", ["event", "resources", "plan"])
def test_stale_approved_result_cannot_publish(tmp_path, change):
    path = tmp_path / "stale.sqlite3"
    with TestClient(create_app(path)) as client:
        record = submit(client)
        result = assess(client, record)
        assert act(client, record, "approve", result).status_code == 200
        with sqlite3.connect(path) as conn:
            if change == "event":
                conn.execute(
                    "INSERT INTO event_history(fingerprint,payload,recorded_at) "
                    "SELECT fingerprint,payload,recorded_at FROM event_history LIMIT 1"
                )
            elif change == "resources":
                conn.execute(
                    "INSERT INTO production_inputs VALUES(1,?)", (json.dumps({"unexpected": True}),)
                )
            else:
                raw = json.loads(conn.execute("SELECT payload FROM current_plan").fetchone()[0])
                raw["version"] += 1
                conn.execute("UPDATE current_plan SET payload=?", (json.dumps(raw),))
        saved = client.get("/api/sales/requests").json()[0]
        assert saved["assessment_stale"] is True
        # Resource shape can be incomplete; stale checks must precede reconstruction.
        response = act(client, record, "publish", result)
        assert response.status_code == 409, response.text
        assert client.get("/api/sales/requests").json()[0]["status"] == "approved"


def test_publish_failure_rolls_back_plan_resources_and_state(tmp_path):
    path = tmp_path / "rollback.sqlite3"
    with TestClient(create_app(path), raise_server_exceptions=False) as client:
        record = submit(client)
        result = assess(client, record)
        assert act(client, record, "approve", result).status_code == 200
        before = client.get("/api/workbench").json()
        with sqlite3.connect(path) as conn:
            conn.execute(
                "CREATE TRIGGER fail_insertion_publication BEFORE INSERT ON decisions "
                "BEGIN SELECT RAISE(ABORT, 'rollback test'); END"
            )
        assert act(client, record, "publish", result).status_code == 500
        assert client.get("/api/workbench").json() == before
        assert client.get("/api/sales/requests").json()[0]["status"] == "approved"
        with sqlite3.connect(path) as conn:
            assert conn.execute("SELECT COUNT(*) FROM production_inputs").fetchone()[0] == 0
            assert conn.execute("SELECT COUNT(*) FROM request_status_history").fetchone()[0] == 2


def test_change_during_publication_is_rechecked_inside_transaction(tmp_path, monkeypatch):
    path = tmp_path / "concurrent.sqlite3"
    app = create_app(path)
    with TestClient(app) as client:
        record = submit(client)
        result = assess(client, record)
        assert act(client, record, "approve", result).status_code == 200
        transition = app.state.sales_requests.repository.transition

        def change_then_publish(*args, **kwargs):
            with sqlite3.connect(path) as conn:
                conn.execute(
                    "INSERT INTO event_history(fingerprint,payload,recorded_at) "
                    "SELECT fingerprint,payload,recorded_at FROM event_history LIMIT 1"
                )
            return transition(*args, **kwargs)

        monkeypatch.setattr(app.state.sales_requests.repository, "transition", change_then_publish)
        response = act(client, record, "publish", result)
        assert response.status_code == 409, response.text
        saved = client.get("/api/sales/requests").json()[0]
        assert saved["status"] == "approved" and saved["assessment_stale"]
        assert client.get("/api/workbench").json()["baseline"]["version"] == 1


def test_other_published_request_requires_new_trial_and_approval(tmp_path):
    with TestClient(create_app(tmp_path / "two.sqlite3")) as client:
        first = submit(client, "first")
        second = submit(client, "second")
        first_result = assess(client, first)
        second_result = assess(client, second)
        assert act(client, first, "approve", first_result).status_code == 200
        assert act(client, second, "approve", second_result).status_code == 200
        assert act(client, first, "publish", first_result).status_code == 200
        assert act(client, second, "publish", second_result).status_code == 409
        renewed = assess(client, second)
        assert act(client, second, "publish", renewed).status_code == 409
        assert act(client, second, "approve", renewed).status_code == 200
        response = act(client, second, "publish", renewed)
        assert response.status_code == 200, response.text


def test_legacy_publication_backfill_preserves_plan_and_approval(tmp_path):
    path = tmp_path / "legacy.sqlite3"
    with TestClient(create_app(path)) as client:
        record = submit(client)
        trial = assess(client, record)
        assert act(client, record, "approve", trial).status_code == 200
        assert act(client, record, "publish", trial).status_code == 200
        expected = client.get("/api/workbench").json()
    with sqlite3.connect(path) as conn:
        payload = json.loads(conn.execute("SELECT payload FROM current_plan").fetchone()[0])
        for op in payload["operations"]:
            op.pop("display_name", None)
            op.pop("order_display_name", None)
        conn.execute("UPDATE current_plan SET payload=?", (json.dumps(payload),))
        evidence = json.loads(conn.execute("SELECT evidence FROM decisions").fetchone()[0])
        evidence.pop("version_summary")
        evidence.pop("published_by")
        conn.execute("UPDATE decisions SET evidence=?", (json.dumps(evidence),))
    before_backups = set((tmp_path / "backups").glob("*.sqlite3"))
    with TestClient(create_app(path)) as client:
        assert client.get("/api/workbench").json() == expected
        assert (
            client.get(f"/api/sales/requests/{record['request_no']}").json()["assessment"] == trial
        )
    backups = set((tmp_path / "backups").glob("*.sqlite3"))
    assert len(backups - before_backups) == 1
    with TestClient(create_app(path)) as client:
        assert client.get("/api/workbench").json() == expected
    assert set((tmp_path / "backups").glob("*.sqlite3")) == backups
