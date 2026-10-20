"""HTTP workflow lifecycle including authoritative human publication."""

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from test_api import token

from sched_copilot.api import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "workflow.sqlite3")) as app:
        yield app


def test_snapshot_change_during_execution_discards_candidates(client):
    service = client.app.state.workbench
    runner = service.workflow_runner

    def update_after_run(*args, **kwargs):
        outcome = runner(*args, **kwargs)
        _, event, revision = service.repository.snapshot()
        service.repository.record_event(replace(event, source="updated during run"), revision)
        return outcome

    service.workflow_runner = update_after_run
    before = client.get("/api/workbench").json()
    response = client.post("/api/workflow", json={**token(before), "intent": "generate_candidates"})
    assert response.status_code == 409
    assert client.get("/api/workbench").json()["baseline"] == before["baseline"]


def test_full_workflow_is_publishable_and_auditable(client):
    before = client.get("/api/workbench").json()
    response = client.post("/api/workflow", json={**token(before), "intent": "generate_candidates"})
    assert response.status_code == 200, response.text
    data = response.json()
    workflow = data["workflow"]
    assert workflow["status"] == "completed", workflow
    assert [t["action"] for t in workflow["trace"]] == [
        "validate",
        "schedule",
        "evaluate",
        "explain",
    ]
    assert len(data["simulation"]["candidates"]) == 2
    evaluation = workflow["results"]["evaluation"]
    for item in evaluation["data"]["evaluations"]:
        metrics = workflow["evidence_catalog"][item["metrics_ref"]]["content"]
        assert metrics["extra_changeovers"] is None
        assert "machine_utilization" in item["missing_metrics"]
    assert client.get("/api/workbench").json()["baseline"] == before["baseline"]
    for intent, action in [("re_evaluate", "evaluate"), ("explain", "explain")]:
        result = client.post(
            "/api/workflow", json={**token(before), "intent": intent, "workflow_id": workflow["id"]}
        )
        assert result.status_code == 200, result.text
        current = result.json()["workflow"]
        assert current["status"] == "completed"
        assert [t["action"] for t in current["trace"]] == [action]
        assert result.json()["simulation"] is None
    simulation = data["simulation"]
    candidate = simulation["candidates"][1]
    published = client.post(
        "/api/decisions",
        json={
            "simulation_id": simulation["id"],
            "candidate_id": candidate["id"],
            "action": "publish",
            "reason": "accept transfer",
            "request_id": "workflow-publish-1",
        },
    )
    assert published.status_code == 200, published.text
    assert (
        published.json()["workbench"]["baseline"]["operations"]
        == candidate["schedule"]["operations"]
    )
    stale = client.post(
        "/api/workflow", json={**token(before), "intent": "explain", "workflow_id": workflow["id"]}
    )
    assert stale.status_code == 409


def test_unknown_recovery_explains_block_and_creates_no_candidates(client):
    before = client.get("/api/workbench").json()
    unknown = client.put(
        "/api/event",
        json={
            **token(before),
            **{k: before["event"][k] for k in ("machine_id", "started_at", "source")},
            "recovered_at": None,
        },
    ).json()
    result = client.post("/api/workflow", json={**token(unknown), "intent": "generate_candidates"})
    assert result.status_code == 200, result.text
    data = result.json()
    assert data["workflow"]["status"] == "blocked"
    assert [t["action"] for t in data["workflow"]["trace"]] == ["validate", "explain"]
    assert data["workflow"]["results"]["explanation"]["data"]
    assert data["simulation"] is None
    assert not client.get("/api/workbench").json()["history"]


def test_validate_only_and_session_requirements(client):
    before = client.get("/api/workbench").json()
    result = client.post("/api/workflow", json={**token(before), "intent": "validate"}).json()
    assert [t["action"] for t in result["workflow"]["trace"]] == ["validate"]
    assert result["simulation"] is None
    for intent in ("explain", "re_evaluate", "explain"):
        assert (
            client.post(
                "/api/workflow", json={**token(before), "intent": intent, "workflow_id": "missing"}
            ).status_code
            == 422
        )
    assert (
        client.post("/api/workflow", json={**token(before), "intent": "unknown"}).status_code == 422
    )


def test_explicit_demo_only_simulates_scheduling_and_keeps_normal_generation_available(client):
    before = client.get("/api/workbench").json()
    request = {**token(before), "intent": "generate_candidates", "demo_fallback": True}
    assert client.get("/api/workflow/demo").json()["available"]
    response = client.post("/api/workflow", json=request)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["workflow"]["status"] == "completed"
    assert len(data["simulation"]["candidates"]) == 2
    trace = data["workflow"]["trace"]
    execution = next(t["execution"] for t in trace if t["action"] == "schedule")
    assert execution["simulated"] is True
    assert execution["error_code"] == "DEMO_FALLBACK"
    assert execution["calls"] == 0
    assert all(t["execution"] is None for t in trace if t["action"] != "schedule")
    assert not data["workflow"]["demo"]["available"]
    again = client.post("/api/workflow", json=request)
    assert again.status_code == 409
    assert again.json()["code"] == "demo_cooldown"
    normal = client.post("/api/workflow", json={**request, "demo_fallback": False})
    assert normal.status_code == 200
    assert all(t["execution"] is None for t in normal.json()["workflow"]["trace"])
    assert client.get("/api/workbench").json()["baseline"] == before["baseline"]
    assert client.post("/api/workflow", json={**request, "intent": "validate"}).status_code == 422


def test_blocked_validation_does_not_consume_demo(client):
    before = client.get("/api/workbench").json()
    unknown = client.put(
        "/api/event",
        json={
            **token(before),
            **{k: before["event"][k] for k in ("machine_id", "started_at", "source")},
            "recovered_at": None,
        },
    ).json()
    response = client.post(
        "/api/workflow",
        json={**token(unknown), "intent": "generate_candidates", "demo_fallback": True},
    )
    assert response.status_code == 200
    assert response.json()["workflow"]["status"] == "blocked"
    assert client.get("/api/workflow/demo").json()["available"]


def test_session_reuse_rejects_changed_event_even_with_current_request_version(client):
    before = client.get("/api/workbench").json()
    result = client.post("/api/workflow", json={**token(before), "intent": "validate"}).json()
    newer = client.put(
        "/api/event",
        json={
            **token(before),
            **{k: before["event"][k] for k in ("machine_id", "started_at", "recovered_at")},
            "source": "updated source",
        },
    ).json()
    assert (
        client.post(
            "/api/workflow",
            json={**token(newer), "intent": "explain", "workflow_id": result["workflow"]["id"]},
        ).status_code
        == 409
    )


def test_single_candidate_continues_evaluation_explanation_and_followups(client):
    state = client.get("/api/workbench").json()
    response = client.put(
        "/api/event",
        json={
            **token(state),
            "machine_id": "M3",
            "started_at": "2026-10-19T13:00:00+08:00",
            "recovered_at": "2026-10-19T13:01:00+08:00",
            "source": "no affected work",
        },
    )
    assert response.status_code == 200
    before = client.get("/api/workbench").json()
    response = client.post("/api/workflow", json={**token(before), "intent": "generate_candidates"})
    assert response.status_code == 200
    data = response.json()
    workflow = data["workflow"]
    assert workflow["status"] == "completed"
    assert len(data["simulation"]["candidates"]) == 1
    assert len(workflow["results"]["evaluation"]["data"]["evaluations"]) == 1
    for intent in ("explain", "re_evaluate", "explain"):
        response = client.post(
            "/api/workflow",
            json={
                **token(before),
                "intent": intent,
                "workflow_id": workflow["id"],
                "question": "比较方案并推荐最优方案",
            },
        )
        assert response.status_code == 200
        workflow = response.json()["workflow"]
        assert workflow["status"] == "completed"
        if intent == "re_evaluate":
            assert len(workflow["results"]["evaluation"]["data"]["evaluations"]) == 1
            continue
        explanation = workflow["results"]["explanation"]["data"]
        assert "仅有一个不同的可行候选" in explanation["summary"]
        assert "原计划对照" in explanation["summary"]
        assert "无需进行多方案取舍" in explanation["summary"]
        assert not explanation["tradeoffs"]
        assert all(s["requires_human_confirmation"] for s in explanation["next_steps"])
        assert any("全局唯一最优解" in item for item in explanation["limitations"])
    assert client.get("/api/workbench").json()["baseline"] == before["baseline"]
