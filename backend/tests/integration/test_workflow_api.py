"""HTTP workflow lifecycle including authoritative human publication."""

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from test_api import token
from test_fault_reviews import approve_fault

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
    approve_fault(client, simulation["id"], candidate["id"])
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


def test_published_fault_preserves_analysis_and_original_impact_after_reload(client):
    import json

    before = client.get("/api/workbench").json()
    data = client.post(
        "/api/workflow", json={**token(before), "intent": "generate_candidates"}
    ).json()
    candidate = data["simulation"]["candidates"][1]
    approve_fault(client, data["simulation"]["id"], candidate["id"])
    response = client.post(
        "/api/decisions",
        json={
            "simulation_id": data["simulation"]["id"],
            "candidate_id": candidate["id"],
            "action": "publish",
            "reason": "确认调整",
            "request_id": "fault-provenance",
        },
    )
    assert response.status_code == 200, response.text
    state = response.json()["workbench"]
    assert state["affected"] == []
    publication = state["plan_publication"]
    assert publication["version"] == state["baseline"]["version"]
    analysis = publication["fault_analysis"]
    assert analysis["event_revision"] == state["event_revision"]
    assert analysis["affected"] == before["affected"]
    assert analysis["workflow"]["trace_id"] == data["workflow"]["trace_id"]
    assert len(analysis["workflow"]["trace"]) == 4
    overview = client.get("/api/workbench").json()["plan_publication"]
    assert "fault_analysis" not in overview
    assert "current_fault_analysis" not in overview
    assert client.get(f"/api/events/{before['event_revision']}/analysis").json() == analysis
    # Existing V4 decisions must work without a database migration/reset.
    repository = client.app.state.workbench.repository
    with repository._connect() as conn:
        raw = conn.execute(
            "SELECT evidence FROM decisions WHERE request_id='fault-provenance'"
        ).fetchone()[0]
        evidence = json.loads(raw)
        evidence.pop("affected")
        conn.execute(
            "UPDATE decisions SET evidence=? WHERE request_id='fault-provenance'",
            (json.dumps(evidence),),
        )
    overview = client.get("/api/workbench").json()["plan_publication"]
    assert "fault_analysis" not in overview
    assert "current_fault_analysis" not in overview
    assert overview["fault_traces"][0]["event_revision"] == state["event_revision"]
    updated = client.put(
        "/api/event",
        json={
            **token(state),
            **{k: state["event"][k] for k in ("machine_id", "started_at", "recovered_at")},
            "source": "new fault revision",
        },
    ).json()
    assert updated["event_revision"] != analysis["event_revision"]
    assert client.get(f"/api/events/{analysis['event_revision']}/analysis").json() == analysis


def test_unknown_recovery_stops_at_validation_and_creates_no_candidates(client):
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
    assert [t["action"] for t in data["workflow"]["trace"]] == ["validate"]
    assert data["workflow"]["results"].get("explanation") is None
    validation = data["workflow"]["results"]["validation"]
    assert validation["quality"]["score"] == 0
    assert validation["errors"][0]["code"] == "RECOVERY_TIME_UNKNOWN"
    assert data["simulation"] is None
    assert not client.get("/api/workbench").json()["history"]


def test_historical_analysis_survives_new_fault_and_restart_without_publication(client):
    before = client.get("/api/workbench").json()
    data = client.post(
        "/api/workflow", json={**token(before), "intent": "generate_candidates"}
    ).json()
    assert data["workflow"]["status"] == "completed"
    updated = client.put(
        "/api/event",
        json={
            **token(before),
            "machine_id": "M2",
            "started_at": before["event"]["started_at"],
            "recovered_at": before["event"]["recovered_at"],
            "source": "new fault",
        },
    ).json()
    path = f"/api/events/{before['event_revision']}/analysis"
    response = client.get(path)
    assert response.status_code == 200, response.text
    archive = response.json()
    assert archive["event_revision"] == before["event_revision"]
    assert archive["baseline"] == before["baseline"]
    assert archive["affected"] == before["affected"]
    assert archive["workflow"]["trace_id"] == data["workflow"]["trace_id"]
    assert len(archive["workflow"]["trace"]) == 4
    assert archive["workflow"]["results"] == data["workflow"]["results"]
    saved = archive["simulation"]
    assert saved["id"] == data["simulation"]["id"]
    assert saved["baseline_fingerprint"] == before["baseline"]["fingerprint"]
    for original, restored in zip(
        data["simulation"]["candidates"], saved["candidates"], strict=True
    ):
        # The validation snapshot stores order IDs rather than product display names.
        assert {k: v for k, v in restored.items() if k != "order_impacts"} == {
            k: v for k, v in original.items() if k != "order_impacts"
        }
        assert [
            {k: v for k, v in item.items() if k != "名称"} for item in restored["order_impacts"]
        ] == [{k: v for k, v in item.items() if k != "名称"} for item in original["order_impacts"]]
    assert client.get(f"/api/events/{updated['event_revision']}/analysis").json() is None
    assert client.get("/api/events/99999/analysis").json() is None
    overview = client.get("/api/workbench").json()
    assert overview["baseline"] == updated["baseline"]
    assert overview["event"] == updated["event"]
    assert "current_fault_analysis" not in overview["plan_publication"]
    with TestClient(create_app(client.app.state.workbench.repository.path)) as restarted:
        assert restarted.get(path).json() == archive


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


def test_copilot_answers_without_rerunning_or_mutating_workflow(client, monkeypatch):
    before = client.get("/api/workbench").json()
    generated = client.post(
        "/api/workflow", json={**token(before), "intent": "generate_candidates"}
    ).json()
    latest = client.get("/api/workflow/latest").json()
    service = client.app.state.workbench
    monkeypatch.setattr(service.copilot_agent, "unavailable_code", "MODEL_NOT_CONFIGURED")

    def forbidden(*args, **kwargs):
        raise AssertionError("QA must not generate or write")

    monkeypatch.setattr(service, "run_workflow", forbidden)
    monkeypatch.setattr(service.repository, "record_simulation", forbidden)
    monkeypatch.setattr(service.repository, "record_workflow", forbidden)
    response = client.post(
        "/api/copilot/ask",
        json={
            **token(before),
            "workflow_id": generated["workflow"]["id"],
            "question": "如果不转移会怎样？",
        },
    )
    assert response.status_code == 200, response.text
    answer = response.json()
    assert answer["mode"] == "fallback"
    assert answer["execution"]["calls"] == 0
    assert "延期" in answer["answer"]
    assert answer["knowledge"]["status"] == "matched"
    assert client.get("/api/workbench").json() == before
    assert client.get("/api/workflow/latest").json() == latest


def test_copilot_rejects_stale_and_unknown_results(client):
    before = client.get("/api/workbench").json()
    generated = client.post(
        "/api/workflow", json={**token(before), "intent": "generate_candidates"}
    ).json()
    request = {
        **token(before),
        "workflow_id": generated["workflow"]["id"],
        "question": "延期风险？",
    }
    assert (
        client.post("/api/copilot/ask", json={**request, "workflow_id": "missing"}).status_code
        == 409
    )
    assert client.post("/api/copilot/ask", json={**request, "question": "  "}).status_code == 422
    assert (
        client.post(
            "/api/copilot/ask", json={**request, "intent": "generate_candidates"}
        ).status_code
        == 422
    )
    changed = client.put(
        "/api/event",
        json={
            **token(before),
            "machine_id": before["event"]["machine_id"],
            "started_at": before["event"]["started_at"],
            "recovered_at": before["event"]["recovered_at"],
            "source": "已变更",
        },
    )
    assert changed.status_code == 200
    assert client.post("/api/copilot/ask", json=request).status_code == 409


def test_copilot_live_answer_uses_only_selected_server_facts(client, monkeypatch):
    from langchain_core.messages import AIMessage

    before = client.get("/api/workbench").json()
    generated = client.post(
        "/api/workflow", json={**token(before), "intent": "generate_candidates"}
    ).json()

    class Model:
        def bind_tools(self, *args, **kwargs):
            return self

        def invoke(self, messages):
            return AIMessage(
                content="伪造已发布和收益99999",
                tool_calls=[{"id": "qa", "name": "submit_focus", "args": {"focus_ids": ["B1"]}}],
            )

    agent = client.app.state.workbench.copilot_agent
    monkeypatch.setattr(agent, "unavailable_code", None)
    monkeypatch.setattr(agent, "model_factory", lambda: Model())
    response = client.post(
        "/api/copilot/ask",
        json={
            **token(before),
            "workflow_id": generated["workflow"]["id"],
            "question": "方案影响？",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "live"
    assert data["execution"]["calls"] == 1
    assert "99999" not in str(data)
    assert "延期订单" in data["answer"]


def test_copilot_discards_answer_if_snapshot_changes_during_model_call(client, monkeypatch):
    before = client.get("/api/workbench").json()
    generated = client.post(
        "/api/workflow", json={**token(before), "intent": "generate_candidates"}
    ).json()
    service = client.app.state.workbench
    run = service.copilot_agent.run

    def changing(*args, **kwargs):
        result = run(*args, **kwargs)
        _, event, revision = service.repository.snapshot()
        service.repository.record_event(replace(event, source="问答期间改变"), revision)
        return result

    monkeypatch.setattr(service.copilot_agent, "run", changing)
    response = client.post(
        "/api/copilot/ask",
        json={
            **token(before),
            "workflow_id": generated["workflow"]["id"],
            "question": "方案影响？",
        },
    )
    assert response.status_code == 409
