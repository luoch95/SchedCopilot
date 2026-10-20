"""Optional SQLite demo data drives a complete, measurable four-Agent run."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from sched_copilot.api import create_app
from sched_copilot.scenarios.production_demo import demo_production_inputs
from sched_copilot.seed_demo import seed


@pytest.fixture
def seeded(tmp_path):
    path = tmp_path / "production.sqlite3"
    with TestClient(create_app(path)) as client:
        before = client.get("/api/workbench").json()
        service = client.app.state.workbench
        assert service.repository.seed_production_inputs(demo_production_inputs())
        assert not service.repository.seed_production_inputs({"different": True})
        assert client.get("/api/workbench").json() == before
        yield client


def run(client):
    state = client.get("/api/workbench").json()
    version = {
        "event_revision": state["event_revision"],
        "baseline_fingerprint": state["baseline"]["fingerprint"],
    }
    response = client.post("/api/workflow", json={**version, "intent": "generate_candidates"})
    assert response.status_code == 200, response.text
    return response.json(), version


def test_seeded_workflow_calculates_setup_and_utilization(seeded):
    result, version = run(seeded)
    workflow = result["workflow"]
    assert workflow["status"] == "completed", workflow["results"]
    assert [t["status"] for t in workflow["trace"]] == ["success"] * 4
    assert len(result["simulation"]["candidates"]) == 2
    assert workflow["results"]["explanation"]["data"]["risks"]
    catalog = workflow["evidence_catalog"]
    for item in workflow["results"]["evaluation"]["data"]["evaluations"]:
        assert item["missing_metrics"] == []
        metrics = catalog[item["metrics_ref"]]["content"]
        assert metrics["changeover_minutes"] > 0
        assert metrics["changeovers"] > 0
        assert metrics["extra_changeovers"] is not None
        for load in metrics["machine_loads"]:
            assert load["available_minutes"] > 0
            assert 0 <= load["utilization"] <= 1
            assert load["utilization"] == pytest.approx(
                (load["processing_minutes"] + load["setup_minutes"]) / load["available_minutes"]
            )
    simulated = result["simulation"]
    published = seeded.post(
        "/api/decisions",
        json={
            "simulation_id": simulated["id"],
            "candidate_id": simulated["candidates"][1]["id"],
            "action": "publish",
            "reason": "demo validation",
            "request_id": "production-demo-publish",
        },
    )
    assert published.status_code == 200, published.text


def test_seed_is_idempotent_and_preserves_plan_and_history(tmp_path):
    path = tmp_path / "seed.sqlite3"
    with TestClient(create_app(path)) as client:
        before = client.get("/api/workbench").json()
    first = seed(path)
    second = seed(path)
    assert first["inserted"] and not second["inserted"]
    assert first["backup"]
    with TestClient(create_app(path)) as client:
        assert client.get("/api/workbench").json() == before


@pytest.mark.parametrize("bad_field", ["unknown_machine", "unknown_initial_mold"])
def test_invalid_production_data_blocks_generation(tmp_path, bad_field):
    with TestClient(create_app(tmp_path / "invalid.sqlite3")) as client:
        payload = demo_production_inputs()
        if bad_field == "unknown_machine":
            payload["production"]["shifts"][0]["machine_id"] = "unknown"
        else:
            payload["production"]["initial_molds"]["M1"] = "unknown"
        client.app.state.workbench.repository.seed_production_inputs(payload)
        result, _ = run(client)
        assert result["workflow"]["status"] == "blocked"
        assert result["simulation"] is None


def test_resource_update_invalidates_existing_session(tmp_path):
    with TestClient(create_app(tmp_path / "updated.sqlite3")) as client:
        result, version = run(client)
        client.app.state.workbench.repository.seed_production_inputs(demo_production_inputs())
        response = client.post(
            "/api/workflow",
            json={**version, "intent": "re_evaluate", "workflow_id": result["workflow"]["id"]},
        )
        assert response.status_code == 409


def test_m3_wait_changes_are_explained_and_keep_machine_queues(seeded):
    before = seeded.get("/api/workbench").json()
    response = seeded.put(
        "/api/event",
        json={
            "event_revision": before["event_revision"],
            "baseline_fingerprint": before["baseline"]["fingerprint"],
            "machine_id": "M3",
            "started_at": "2026-10-19T13:00:00+08:00",
            "recovered_at": "2026-10-19T17:00:00+08:00",
            "source": "demo",
        },
    )
    assert response.status_code == 200, response.text
    baseline = seeded.get("/api/workbench").json()["baseline"]
    result, _ = run(seeded)
    assert result["workflow"]["status"] == "completed"
    wait = next(c for c in result["simulation"]["candidates"] if c["label"] == "原计划对照")
    for machine in ("M1", "M2", "M3"):

        def queue(ops):
            return [
                o["id"] for o in sorted(ops, key=lambda o: o["start"]) if o["machine_id"] == machine
            ]

        assert queue(wait["schedule"]["operations"]) == queue(baseline["operations"])
    changed = {row["工序"]: row for row in wait["changes"]}
    assert "换型:M1:15分钟" in changed["O1002-OP1"]["依据"]
    assert changed["O1002-OP1"]["类型"] == "策略调整"
    assert "故障:M3" not in changed["O1002-OP1"]["影响链"]
    assert "恢复后换型:M3:15分钟" in changed["O1002-OP2"]["依据"]
    assert changed["O1004-OP2"]["影响链"].startswith("故障:M3")
    for op in baseline["operations"]:
        after = next(o for o in wait["schedule"]["operations"] if o["id"] == op["id"])
        if op["status"] == "completed":
            assert after == op
    assert seeded.get("/api/workbench").json()["baseline"] == baseline
    transfer = next(
        c for c in result["simulation"]["candidates"] if c["label"] == "允许合格设备转移"
    )
    moved = next(row for row in transfer["changes"] if row["工序"] == "O1002-OP1")
    assert moved["新设备"] == "M2"
    assert moved["类型"] == "策略调整"
    assert "M1没有故障" in moved["依据"]
    assert "13:15" in moved["依据"] and "13:00" in moved["依据"]
    assert "因此将该工序转到M2，可提前15分钟开工。" in moved["依据"]
    assert "+08:00" not in moved["依据"]
    explanation = result["workflow"]["results"]["explanation"]["data"]
    assert any("M1没有故障" in fact["text"] for fact in explanation["facts"])
    assert all("+08:00" not in fact["text"] for fact in explanation["facts"])
    evaluations = result["workflow"]["results"]["evaluation"]["data"]["evaluations"]
    catalog = result["workflow"]["evidence_catalog"]
    for candidate, expected_counts in ((wait, [2, 1, 2]), (transfer, [1, 3, 1])):
        evaluation = next(e for e in evaluations if e["candidate_id"] == candidate["id"])
        metrics = catalog[evaluation["metrics_ref"]]["content"]
        loads = sorted(metrics["machine_loads"], key=lambda load: load["machine_id"])
        assert [load["changeovers"] for load in loads] == expected_counts
        assert [load["setup_minutes"] for load in loads] == [n * 15 for n in expected_counts]
        assert metrics["changeovers"] == sum(expected_counts) == 5
        assert metrics["changeover_minutes"] == sum(load["setup_minutes"] for load in loads) == 75


def test_fault_tradeoff_mock_has_real_delivery_costs_and_is_repeatable(tmp_path):
    from datetime import datetime

    from sched_copilot.seed_demo import seed_fault_comparison

    path = tmp_path / "tradeoff.sqlite3"
    with TestClient(create_app(path)) as client:
        initial = client.get("/api/workbench").json()
    loaded = seed_fault_comparison(path)
    assert loaded["inserted"] and Path(loaded["backup"]).exists()
    assert not seed_fault_comparison(path)["inserted"]
    with TestClient(create_app(path)) as client:
        state = client.get("/api/workbench").json()
        assert state["baseline"]["version"] == initial["baseline"]["version"] + 1
        response = client.put(
            "/api/event",
            json={
                "event_revision": state["event_revision"],
                "baseline_fingerprint": state["baseline"]["fingerprint"],
                "machine_id": "M3",
                "started_at": "2026-10-19T13:00:00+08:00",
                "recovered_at": "2026-10-19T17:00:00+08:00",
                "source": "test",
            },
        )
        assert response.status_code == 200
        baseline = client.get("/api/workbench").json()["baseline"]
        result, _ = run(client)
        assert result["workflow"]["status"] == "completed"
        candidates = result["simulation"]["candidates"]
        assert len(candidates) == 2
        assert len({c["schedule"]["fingerprint"] for c in candidates}) == 2
        wait, transfer = candidates
        due = {o["id"]: datetime.fromisoformat(o["due"]) for o in state["orders"]}

        def lateness(candidate, order):
            end = max(
                datetime.fromisoformat(op["end"])
                for op in candidate["schedule"]["operations"]
                if op["order_id"] == order
            )
            return max(0, (end - due[order]).total_seconds() / 60)

        assert lateness(wait, "O1002") == 75
        assert lateness(transfer, "O1002") == 0
        assert lateness(wait, "O1005") == 0
        assert lateness(transfer, "O1005") == 105
        for candidate in candidates:
            for before in baseline["operations"]:
                if before["status"] != "planned":
                    assert (
                        next(
                            o
                            for o in candidate["schedule"]["operations"]
                            if o["id"] == before["id"]
                        )
                        == before
                    )
        assert client.get("/api/workbench").json()["baseline"] == baseline
        assert result["workflow"]["results"]["explanation"]["data"]["tradeoffs"]
