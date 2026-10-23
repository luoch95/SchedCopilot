"""The dashboard can browse real fault revisions without changing the active event."""

from dataclasses import replace

from fastapi.testclient import TestClient

from sched_copilot.api import create_app


def test_workbench_returns_all_fault_revisions_after_restart(tmp_path):
    path = tmp_path / "fault-history.sqlite3"
    with TestClient(create_app(path)) as client:
        service = client.app.state.workbench
        _, event, revision = service.repository.snapshot()
        changed = replace(event, source="历史列表验证")
        next_revision = service.repository.record_event(changed, revision)
        snapshot = client.get("/api/workbench").json()
        history = snapshot["event_history"]
        assert [row["revision"] for row in history] == [next_revision, revision]
        assert history[0]["source"] == "历史列表验证"
        assert history[0]["created_at"]
        assert history[0]["started_at"]
        assert snapshot["event_revision"] == next_revision
    with TestClient(create_app(path)) as client:
        assert client.get("/api/workbench").json()["event_history"] == history
