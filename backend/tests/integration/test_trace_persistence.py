"""Trace and candidate recovery must read SQLite, even after backend restart."""

import json
import sqlite3
from dataclasses import replace

from fastapi.testclient import TestClient

from sched_copilot.api import create_app
from sched_copilot.config import Settings


def settings_for(path):
    return replace(Settings.from_env(), database_path=path, workflow_model_mode="rules")


def version(client):
    snapshot = client.get("/api/workbench").json()
    return {
        "event_revision": snapshot["event_revision"],
        "baseline_fingerprint": snapshot["baseline"]["fingerprint"],
    }


def test_trace_restores_after_restart_and_retains_candidates_for_followup(tmp_path):
    path = tmp_path / "trace.sqlite3"
    settings = settings_for(path)
    with TestClient(create_app(settings=settings)) as client:
        assert client.get("/api/workflow/latest").json() is None
        before = client.get("/api/workbench").json()
        response = client.post(
            "/api/workflow", json={**version(client), "intent": "generate_candidates"}
        )
        assert response.status_code == 200, response.text
        result = response.json()
        trace_id = result["workflow"]["trace_id"]
        assert trace_id.startswith("TRC-")
        steps = result["workflow"]["trace"]
        assert len({step["span_id"] for step in steps}) == len(steps) == 4
        assert all(step["elapsed_ms"] >= 0 for step in steps)
        assert client.get("/api/workflow/latest").json() == result
        assert client.get("/api/workbench").json() == before
    with sqlite3.connect(path) as connection:
        row = connection.execute(
            "SELECT payload FROM workflow_runs WHERE trace_id=?", (trace_id,)
        ).fetchone()
        assert json.loads(row[0]) == result["workflow"]
    with TestClient(create_app(settings=settings)) as client:
        assert not client.app.state.workbench.workflow_runner._sessions
        assert client.get("/api/workflow/latest").json() == result
        # A restored workflow also supports further explanation without regeneration.
        response = client.post(
            "/api/workflow",
            json={
                **version(client),
                "intent": "explain",
                "question": "说明方案风险",
                "workflow_id": result["workflow"]["id"],
            },
        )
        assert response.status_code == 200, response.text
        followup = response.json()
        assert followup["workflow"]["trace_id"] != trace_id
        assert followup["simulation"] is None
        restored = client.get("/api/workflow/latest").json()
        assert restored["workflow"] == followup["workflow"]
        assert restored["simulation"] == result["simulation"]
        # A new fault revision must not revive an older analysis as current.
        service = client.app.state.workbench
        _, event, revision = service.repository.snapshot()
        service.repository.record_event(replace(event, source="维修进度更新"), revision)
        assert client.get("/api/workflow/latest").json() is None


def test_new_trace_per_run_and_resource_change_prevents_restore(tmp_path):
    settings = settings_for(tmp_path / "trace.sqlite3")
    with TestClient(create_app(settings=settings)) as client:
        body = {**version(client), "intent": "validate"}
        first = client.post("/api/workflow", json=body).json()
        second = client.post("/api/workflow", json=body).json()
        assert first["workflow"]["trace_id"] != second["workflow"]["trace_id"]
        assert client.get("/api/workflow/latest").json() == second
        runner = client.app.state.workbench.workflow_runner
        runner.production_provider = lambda: {"changed": True}
        assert client.get("/api/workflow/latest").json() is None


def test_blocked_trace_is_persistent_without_publishable_candidates(tmp_path):
    settings = settings_for(tmp_path / "trace.sqlite3")
    with TestClient(create_app(settings=settings)) as client:
        service = client.app.state.workbench
        _, event, revision = service.repository.snapshot()
        service.repository.record_event(replace(event, recovered_at=None), revision)
        result = client.post(
            "/api/workflow", json={**version(client), "intent": "generate_candidates"}
        ).json()
        assert result["workflow"]["status"] == "blocked"
        assert result["simulation"] is None
    with TestClient(create_app(settings=settings)) as client:
        assert client.get("/api/workflow/latest").json() == result
