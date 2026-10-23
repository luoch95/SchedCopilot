"""Physical deletion removes fault artifacts without rolling back published plans."""

import sqlite3

from fastapi.testclient import TestClient
from test_api import token
from test_fault_reviews import approve_fault
from test_manual_faults import confirm, create

from sched_copilot.api import create_app


def test_cancel_persists_and_excludes_outage_without_rolling_back_plan(tmp_path):
    path = tmp_path / "cancel.sqlite3"
    with TestClient(create_app(path)) as client:
        before = client.get("/api/workbench").json()
        generated = client.post(
            "/api/workflow", json={**token(before), "intent": "generate_candidates"}
        ).json()
        simulation = generated["simulation"]
        candidate = simulation["candidates"][1]
        approve_fault(client, simulation["id"], candidate["id"])
        manual = confirm(client, create(client, generated))
        assert client.get(f"/api/fault-drafts/{manual['id']}").status_code == 200
        response = client.post("/api/event/cancel", json=token(before))
        assert response.status_code == 200, response.text
        after = response.json()
        assert after["event_cancelled"]
        assert after["event_revision"] > before["event_revision"]
        assert after["baseline"] == before["baseline"]
        assert after["affected"] == after["issues"] == []
        assert after["event_history"] == []
        assert client.get(f"/api/fault-drafts/{manual['id']}").status_code == 404
        with sqlite3.connect(path) as db:
            for table in (
                "event_history",
                "current_event",
                "cancelled_events",
                "workflow_runs",
                "simulations",
                "fault_reviews",
                "manual_fault_drafts",
                "manual_fault_revisions",
            ):
                assert db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0
        assert client.app.state.workbench.repository.failure_windows() == ()
        assert client.get("/api/workflow/latest").json() is None
        assert client.get(f"/api/events/{before['event_revision']}/analysis").json() is None
        assert client.post("/api/event/cancel", json=token(before)).status_code == 409
        assert client.post("/api/simulations", json=token(after)).status_code == 422
        assert client.post("/api/event/recover", json=token(after)).status_code == 422
        publish = client.post(
            "/api/decisions",
            json={
                "simulation_id": simulation["id"],
                "candidate_id": candidate["id"],
                "action": "publish",
                "reason": "old approval",
                "request_id": "old-publish",
            },
        )
        assert publish.status_code == 404
        draft = client.post(
            "/api/fault-drafts",
            json={
                "workflow_id": generated["workflow"]["id"],
                "operator_role": "planner",
            },
        )
        assert draft.status_code == 409
    with TestClient(create_app(path)) as client:
        restored = client.get("/api/workbench").json()
        assert restored["event_cancelled"]
        assert restored["baseline"] == before["baseline"]
        assert client.app.state.workbench.repository.failure_windows() == ()
        # Identical re-entry must create a fresh, usable revision.
        saved = client.put(
            "/api/event",
            json={
                **token(restored),
                **{k: v for k, v in before["event"].items() if k != "received_at"},
            },
        )
        assert saved.status_code == 200, saved.text
        assert not saved.json()["event_cancelled"]
        assert saved.json()["event_revision"] > restored["event_revision"]
        assert len(client.app.state.workbench.repository.failure_windows()) == 1


def test_published_fault_deleted_without_rolling_back_plan(tmp_path):
    with TestClient(create_app(tmp_path / "published.sqlite3")) as client:
        before = client.get("/api/workbench").json()
        simulation = client.post("/api/simulations", json=token(before)).json()
        candidate = simulation["candidates"][1]
        approve_fault(client, simulation["id"], candidate["id"])
        published = client.post(
            "/api/decisions",
            json={
                "simulation_id": simulation["id"],
                "candidate_id": candidate["id"],
                "action": "publish",
                "reason": "approved",
                "request_id": "publish",
            },
        )
        assert published.status_code == 200, published.text
        state = published.json()["workbench"]
        response = client.post("/api/event/cancel", json=token(state))
        assert response.status_code == 200, response.text
        after = response.json()
        assert after["baseline"] == state["baseline"]
        assert after["event_history"] == []
        assert after["plan_publication"]["fault_traces"] == []
        assert after["plan_publication"]["fault_analysis"] is None
        assert after["plan_publication"]["history"] == state["plan_publication"]["history"]


def test_historical_delete_removes_family_and_invalidates_dependent_snapshots(tmp_path):
    path = tmp_path / "history.sqlite3"
    with TestClient(create_app(path)) as client:
        first = client.get("/api/workbench").json()
        # Same outage, revised recovery time: both revisions must be physically deleted.
        revised = client.put(
            "/api/event",
            json={
                **token(first),
                **{k: v for k, v in first["event"].items() if k != "received_at"},
                "recovered_at": "2026-10-19T18:00:00+08:00",
                "source": "manual test",
            },
        ).json()
        other = client.put(
            "/api/event",
            json={
                **token(revised),
                "machine_id": "M2",
                "started_at": "2026-10-19T13:00:00+08:00",
                "recovered_at": "2026-10-19T15:00:00+08:00",
                "source": "test",
            },
        ).json()
        generated = client.post(
            "/api/workflow",
            json={
                **token(other),
                "intent": "generate_candidates",
            },
        )
        assert generated.status_code == 200, generated.text
        assert client.app.state.workbench.repository.latest_workflow()
        # Stale deletion is atomic and must leave both outage families intact.
        stale = client.post(f"/api/events/{first['event_revision']}/cancel", json=token(first))
        assert stale.status_code == 409
        assert len(client.app.state.workbench.repository.failure_windows()) == 2
        result = client.post(f"/api/events/{first['event_revision']}/cancel", json=token(other))
        assert result.status_code == 200, result.text
        after = result.json()
        assert after["baseline"] == first["baseline"]
        assert after["event"] == other["event"]
        assert after["event_revision"] > other["event_revision"]
        assert {e["machine_id"] for e in after["event_history"]} == {"M2"}
        assert len(client.app.state.workbench.repository.failure_windows()) == 1
        assert client.app.state.workbench.repository.latest_workflow() is None
        assert client.get("/api/workflow/latest").json() is None
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT COUNT(*) FROM simulations").fetchone()[0] == 0
        repeated = client.post(f"/api/events/{first['event_revision']}/cancel", json=token(after))
        assert repeated.status_code == 409
