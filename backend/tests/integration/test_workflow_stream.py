import asyncio
import json
from threading import Event

import pytest
from fastapi.testclient import TestClient

from sched_copilot.api import create_app
from sched_copilot.api.workflow_stream import workflow_stream


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "stream.sqlite3")) as client:
        yield client


def request_body(client):
    state = client.get("/api/workbench").json()
    return {
        "event_revision": state["event_revision"],
        "baseline_fingerprint": state["baseline"]["fingerprint"],
        "intent": "generate_candidates",
        "question": "解释候选方案",
    }


def stream(client, body):
    response = client.post("/api/workflow", json=body, headers={"Accept": "application/x-ndjson"})
    assert response.status_code == 200
    assert "application/x-ndjson" in response.headers["content-type"]
    return [
        json.loads(line)
        for line in response.iter_lines()
        if line and json.loads(line)["type"] != "heartbeat"
    ]


def test_stream_retains_original_results_and_does_not_publish(client):
    body = request_body(client)
    before = client.get("/api/workbench").json()
    events = stream(client, body)
    assert events[0]["type"] == "trace_started"
    assert events[0]["trace_id"].startswith("TRC-")
    assert events[1] == {"type": "plan", "actions": ["validate", "schedule", "evaluate", "explain"]}
    assert [e["action"] for e in events if e["type"] == "stage_started"] == events[1]["actions"]
    result = events[-1]
    assert result["type"] == "result"
    assert result["data"]["workflow"]["status"] == "completed"
    assert result["data"]["workflow"]["trace_id"] == events[0]["trace_id"]
    assert len(result["data"]["simulation"]["candidates"]) == 2
    assert client.get("/api/workbench").json() == before
    # Existing non-streaming clients retain their JSON response contract.
    assert client.post("/api/workflow", json=body).json()["workflow"]["status"] == "completed"


def test_stream_conflict_is_an_error_without_starting_agents(client):
    body = request_body(client)
    body["baseline_fingerprint"] = "outdated"
    events = stream(client, body)
    assert len(events) == 1
    assert events[0]["type"] == "error"
    assert events[0]["status"] == 409
    assert events[0]["code"] == "snapshot_conflict"


def test_stream_validation_only_plans_one_agent(client):
    body = request_body(client)
    body["intent"] = "validate"
    events = stream(client, body)
    assert events[0]["type"] == "trace_started"
    assert events[1] == {"type": "plan", "actions": ["validate"]}
    assert [e["action"] for e in events if e["type"] == "stage_started"] == ["validate"]


def test_demo_stream_discloses_simulation_and_reports_cooldown_separately(client):
    body = {**request_body(client), "demo_fallback": True}
    events = stream(client, body)
    assert events[-1]["type"] == "result"
    trace = events[-1]["data"]["workflow"]["trace"]
    execution = next(step["execution"] for step in trace if step["action"] == "schedule")
    assert execution["simulated"]
    again = stream(client, body)
    assert again[-1]["type"] == "error"
    assert again[-1]["code"] == "demo_cooldown"
    assert not any(event["type"] == "stage_started" for event in again)


def test_disconnect_stops_worker_at_next_checkpoint_without_running_downstream():
    release, stopped = Event(), Event()
    downstream = []

    def execute(emit):
        try:
            emit({"type": "stage_started", "action": "validate"})
            assert release.wait(3)
            # A completed synchronous call observes cancellation at its next boundary.
            emit({"type": "quality_phase", "phase": "checking", "round": 1})
            downstream.append("schedule")
            return {}
        finally:
            stopped.set()

    async def disconnect():
        response = workflow_stream(execute)
        first = await anext(response.body_iterator)
        assert json.loads(first)["action"] == "validate"
        await response.body_iterator.aclose()
        release.set()
        assert await asyncio.to_thread(stopped.wait, 3)

    asyncio.run(disconnect())
    assert downstream == []
