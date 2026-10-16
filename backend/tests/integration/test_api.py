from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from sched_copilot.api import create_app
from sched_copilot.infrastructure.sqlite_repository import DecisionStore
from sched_copilot.scenarios.demo import EVENT_TIME, demo_schedule


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "decisions.sqlite3")) as app:
        yield app


def token(state):
    return {
        "event_revision": state["event_revision"],
        "baseline_fingerprint": state["baseline"]["fingerprint"],
    }


def test_backend_start_directory_does_not_change_data_or_frontend_paths(tmp_path, monkeypatch):
    import sched_copilot.config as config

    backend = tmp_path / "backend"
    backend.mkdir()
    frontend = tmp_path / "frontend" / "dist"
    (frontend / "assets").mkdir(parents=True)
    (frontend / "index.html").write_text("<h1>Schedule Copilot</h1>", encoding="utf-8")
    (frontend / "assets" / "app.js").write_text("console.log('ok')", encoding="utf-8")
    monkeypatch.setattr(config, "REPOSITORY_ROOT", tmp_path)
    monkeypatch.delenv("SCHED_DB_PATH", raising=False)
    monkeypatch.delenv("SCHED_FRONTEND_DIR", raising=False)
    monkeypatch.chdir(backend)
    with TestClient(create_app()) as client:
        assert client.get("/api/workbench").status_code == 200
        assert "Schedule Copilot" in client.get("/").text
        assert client.get("/assets/app.js").status_code == 200
    assert (tmp_path / ".data" / "injection_molding.sqlite3").exists()
    assert not (backend / ".data").exists()


def test_api_exposes_computed_end_and_reuses_existing_store(tmp_path):
    path = tmp_path / "existing.sqlite3"
    store = DecisionStore(path, demo_schedule())
    from sched_copilot.domain.models import MachineFailure

    store.record_event(
        MachineFailure("M3", EVENT_TIME, EVENT_TIME + timedelta(hours=5), "现场", EVENT_TIME)
    )
    with TestClient(create_app(path)) as client:
        state = client.get("/api/workbench").json()
        assert state["event"]["machine_id"] == "M3"
        assert state["event_revision"] == 1
        assert state["baseline"]["operations"][0]["end"].endswith("+08:00")
        assert client.get("/api/health").json() == {
            "status": "ok",
            "live_analysis_configured": False,
        }


def test_api_saves_unknown_recovery_blocks_simulation_and_recovers(client):
    state = client.get("/api/workbench").json()
    payload = {
        **token(state),
        **{key: state["event"][key] for key in ("machine_id", "started_at", "source")},
        "recovered_at": None,
    }
    response = client.put("/api/event", json=payload)
    assert response.status_code == 200
    unknown = response.json()
    assert unknown["event"]["recovered_at"] is None
    assert client.post("/api/simulations", json=token(unknown)).status_code == 409
    restored = client.post("/api/event/recover", json=token(unknown))
    assert restored.status_code == 200
    assert restored.json()["event"]["recovered_at"] is not None
    assert restored.json()["baseline"] == state["baseline"]
    assert client.put("/api/event", json=payload).status_code == 409


def test_api_persists_authoritative_candidates_and_publication_is_idempotent(tmp_path):
    path = tmp_path / "decisions.sqlite3"
    with TestClient(create_app(path)) as first:
        state = first.get("/api/workbench").json()
        batch = first.post("/api/simulations", json=token(state)).json()
    with TestClient(create_app(path)) as restarted:
        chosen = batch["candidates"][1]
        decision = {
            "simulation_id": batch["id"],
            "candidate_id": chosen["id"],
            "action": "publish",
            "reason": "接受转移",
            "request_id": "publish-1",
        }
        assert (
            restarted.post("/api/decisions", json={**decision, "schedule": {}}).status_code == 422
        )
        published = restarted.post("/api/decisions", json=decision)
        assert published.status_code == 200
        assert (
            published.json()["workbench"]["baseline"]["operations"]
            == chosen["schedule"]["operations"]
        )
        assert restarted.post("/api/decisions", json=decision).json()["plan_version"] == 2
        assert len(restarted.get("/api/workbench").json()["history"]) == 1
        decision["request_id"] = "publish-2"
        assert restarted.post("/api/decisions", json=decision).status_code == 409


def test_api_event_roundtrip_invalidates_old_candidates(client):
    state = client.get("/api/workbench").json()
    batch = client.post("/api/simulations", json=token(state)).json()
    original = {
        key: state["event"][key] for key in ("machine_id", "started_at", "recovered_at", "source")
    }
    changed = client.put(
        "/api/event",
        json={
            **token(state),
            **original,
            "recovered_at": (EVENT_TIME + timedelta(hours=5)).isoformat(),
        },
    ).json()
    restored = client.put("/api/event", json={**token(changed), **original}).json()
    assert restored["event_revision"] > state["event_revision"]
    decision = {
        "simulation_id": batch["id"],
        "candidate_id": batch["candidates"][0]["id"],
        "action": "publish",
        "reason": "旧候选不能发布",
        "request_id": "stale",
    }
    assert client.post("/api/decisions", json=decision).status_code == 409
    assert client.post("/api/event/recover", json=token(state)).status_code == 409
    assert client.get("/api/workbench").json()["baseline"]["version"] == 1


def test_api_rejects_invalid_inputs_and_records_rejection(client):
    state = client.get("/api/workbench").json()
    original = {
        key: state["event"][key] for key in ("machine_id", "started_at", "recovered_at", "source")
    }
    assert (
        client.put("/api/event", json={**token(state), **original, "machine_id": "M99"}).status_code
        == 422
    )
    assert (
        client.put(
            "/api/event", json={**token(state), **original, "started_at": "2026-10-19T13:00:00"}
        ).status_code
        == 422
    )
    assert (
        client.put("/api/event", json={**token(state), **original, "source": " "}).status_code
        == 409
    )
    assert (
        client.put(
            "/api/event", json={**token(state), **original, "recovered_at": original["started_at"]}
        ).status_code
        == 409
    )
    batch = client.post("/api/simulations", json=token(state)).json()
    request = {
        "simulation_id": batch["id"],
        "candidate_id": "forged",
        "action": "reject",
        "reason": "现场未确认",
        "request_id": "reject-1",
    }
    assert client.post("/api/decisions", json=request).status_code == 404
    request["candidate_id"] = batch["candidates"][0]["id"]
    response = client.post("/api/decisions", json=request)
    assert response.status_code == 200
    assert response.json()["workbench"]["baseline"] == state["baseline"]
    assert response.json()["workbench"]["history"][0]["action"] == "reject"


def test_api_offline_analysis_and_stale_guard(client):
    state = client.get("/api/workbench").json()
    response = client.post(
        "/api/analysis", json={**token(state), "live": False, "question": "分析交期"}
    )
    assert response.status_code == 200
    assert response.json()["mode"] == "offline"
    assert set(response.json()["reports"]) == {"plan_report", "resource_report", "decision_report"}
    assert (
        client.post("/api/analysis", json={**token(state), "event_revision": 999}).status_code
        == 409
    )


def test_api_error_contract_and_provider_masking(client, monkeypatch):
    state = client.get("/api/workbench").json()
    stale = client.post("/api/simulations", json={**token(state), "event_revision": 999})
    assert stale.json()["code"] == "snapshot_conflict"

    def failure(*args, **kwargs):
        raise RuntimeError("sensitive-provider-token")

    monkeypatch.setattr(client.app.state.workbench, "analyzer", failure)
    response = client.post("/api/analysis", json={**token(state), "live": True})
    assert response.status_code == 502
    assert response.json()["code"] == "analysis_unavailable"
    assert "sensitive-provider-token" not in response.text
