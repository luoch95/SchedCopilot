"""The manual chain preserves human timing and the original AI analysis."""

import json

from fastapi.testclient import TestClient
from test_manual_faults import analyze, approve, create, publish, submit

from sched_copilot.api import create_app


def evaluate(client, draft):
    response = client.post(
        f"/api/fault-drafts/{draft['id']}/evaluate", json={"revision": draft["revision"]}
    )
    assert response.status_code == 200
    events = [json.loads(line) for line in response.text.splitlines()]
    assert not [event for event in events if event["type"] == "error"], events
    return events, next(event["data"] for event in events if event["type"] == "result")


def test_manual_full_chain_keeps_original_and_candidate_immutable(tmp_path):
    path = tmp_path / "manual-chain.sqlite3"
    with TestClient(create_app(path)) as client:
        state, ai = analyze(client)
        review = submit(client, ai)
        approve(client, review)
        draft = create(client, ai)
        assert client.get("/api/workbench").json()["fault_review"]["status"] == "approved"
        events, evaluated = evaluate(client, draft)
        assert [e["action"] for e in events if e["type"] == "stage_started"] == [
            "validate",
            "schedule",
            "evaluate",
            "explain",
        ]
        assert evaluated["status"] == "ready_for_review", evaluated
        assert evaluated["workflow"]["status"] == "completed", evaluated
        assert (
            evaluated["simulation"]["candidates"][0]["schedule"]["fingerprint"]
            == draft["schedule"]["fingerprint"]
        )
        assert evaluated["workflow"]["results"]["evaluation"]["data"]["evaluations"]
        assert evaluated["workflow"]["results"]["explanation"]["data"]
        assert client.get("/api/workflow/latest").json() == ai
        assert client.get("/api/workbench").json()["baseline"] == state["baseline"]
        answer = client.post(
            "/api/copilot/ask",
            json={
                "event_revision": state["event_revision"],
                "baseline_fingerprint": state["baseline"]["fingerprint"],
                "workflow_id": evaluated["workflow"]["id"],
                "question": "人工方案有什么延期风险？",
            },
        )
        assert answer.status_code == 200, answer.text
        assert answer.json()["workflow_id"] == evaluated["workflow"]["id"]
    with TestClient(create_app(path)) as client:
        recovered = client.get("/api/fault-drafts/latest").json()
        assert recovered["workflow"] == evaluated["workflow"]
        assert client.get("/api/workflow/latest").json() == ai
        manual_review = submit(client, recovered, key="manual-chain-review")
        assert manual_review["analysis"]["workflow"] == evaluated["workflow"]
        approve(client, manual_review)
        published = publish(client, recovered)
        assert published.status_code == 200, published.text
        assert (
            published.json()["workbench"]["plan_publication"]["fault_analysis"]["workflow"]
            == evaluated["workflow"]
        )


def test_invalid_manual_schedule_returns_blocked_chain_without_candidate(tmp_path):
    with TestClient(create_app(tmp_path / "blocked.sqlite3")) as client:
        state, ai = analyze(client)
        draft = create(client, ai, source=False)
        _, evaluated = evaluate(client, draft)
        assert evaluated["status"] == "editing"
        assert evaluated["issues"]
        assert evaluated["simulation"] is None
        assert evaluated["workflow"]["status"] == "blocked"
        assert client.get("/api/workbench").json()["baseline"] == state["baseline"]
