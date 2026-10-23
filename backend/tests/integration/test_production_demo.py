"""Optional SQLite demo data drives a complete, measurable four-Agent run."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from test_fault_reviews import approve_fault

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
    approve_fault(seeded, simulated["id"], simulated["candidates"][1]["id"])
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


@pytest.mark.parametrize("manual", [False, True])
def test_shift_overflow_has_real_tail_candidate_and_reviewable_report(tmp_path, manual):
    from datetime import datetime

    from test_manual_faults import approve, confirm, create, publish, submit

    with TestClient(create_app(tmp_path / "tail.sqlite3")) as client:
        payload = demo_production_inputs()
        # Registered shifts end at 16:00; the baseline itself is unchanged.
        payload["production"]["shifts"] = [
            shift
            for shift in payload["production"]["shifts"]
            if datetime.fromisoformat(shift["start_at"]).hour == 8
        ]
        client.app.state.workbench.repository.seed_production_inputs(payload)
        before = client.get("/api/workbench").json()
        result, _ = run(client)
        workflow = result["workflow"]
        assert workflow["status"] == "completed", workflow
        assert [step["action"] for step in workflow["trace"]] == [
            "validate",
            "schedule",
            "evaluate",
            "explain",
        ]
        simulation = result["simulation"]
        candidate = simulation["candidates"][0]
        assert "原线排尾" in candidate["label"]
        baseline_ops = {op["id"]: op for op in before["baseline"]["operations"]}
        for op in candidate["schedule"]["operations"]:
            assert op["machine_id"] == baseline_ops[op["id"]]["machine_id"]
            if op["status"] != "planned":
                assert op == baseline_ops[op["id"]]
        tail = set(before["affected"])
        while True:
            expanded = tail | {
                op["id"]
                for op in baseline_ops.values()
                if any(
                    prev["id"] in tail
                    and prev["order_id"] == op["order_id"]
                    and prev["sequence"] < op["sequence"]
                    for prev in baseline_ops.values()
                )
            }
            if expanded == tail:
                break
            tail = expanded
        for machine in before["machines"]:
            queue = [
                op
                for op in candidate["schedule"]["operations"]
                if op["machine_id"] == machine["id"] and op["status"] == "planned"
            ]
            regular = [op for op in queue if op["id"] not in tail]
            deferred = [op for op in queue if op["id"] in tail]
            if regular and deferred:
                assert max(op["end"] for op in regular) <= min(op["start"] for op in deferred)
        assert candidate["changes"]
        assert any(
            datetime.fromisoformat(op["end"]).hour > 16
            for op in candidate["schedule"]["operations"]
        )
        scheduling = workflow["results"]["scheduling"]
        assert any(w["code"] == "SHIFT_OVERRUN_REQUIRES_REVIEW" for w in scheduling["warnings"])
        assert "超班风险" in str(workflow["results"]["explanation"]["data"])
        checks = [
            e["content"]
            for e in workflow["evidence_catalog"].values()
            if e["kind"] == "candidate_constraints"
        ]
        assert all("shift_calendar" not in c["checked_items"] for c in checks)
        assert all(c["queue_policy"] == "append_tail" for c in checks)
        assert client.get("/api/workbench").json()["baseline"] == before["baseline"]
        if manual:
            draft = create(client, result)
            # A real human edit keeps all hard constraints, moving the last operation later.
            last = max(
                (op for op in draft["schedule"]["operations"] if op["status"] == "planned"),
                key=lambda op: op["end"],
            )
            from datetime import timedelta

            saved = client.put(
                f"/api/fault-drafts/{draft['id']}",
                json={
                    "revision": draft["revision"],
                    "reason": "人工顺延末尾工序",
                    "moves": [
                        {
                            "operation_id": last["id"],
                            "machine_id": last["machine_id"],
                            "start": (
                                datetime.fromisoformat(last["start"]) + timedelta(minutes=30)
                            ).isoformat(),
                        }
                    ],
                },
            )
            assert saved.status_code == 200, saved.text
            assert saved.json()["issues"] == []
            draft = confirm(client, saved.json())
            assert draft["report"]["edits"]
            assert "超班风险" in str(draft["report"]["risks"])
            approve(client, submit(client, draft))
            published = publish(client, draft)
        else:
            approve_fault(client, simulation["id"], candidate["id"])
            published = client.post(
                "/api/decisions",
                json={
                    "simulation_id": simulation["id"],
                    "candidate_id": candidate["id"],
                    "action": "publish",
                    "reason": "确认超班风险",
                    "request_id": "tail-publish",
                },
            )
        assert published.status_code == 200, published.text
        final = published.json()["workbench"]
        assert final["baseline"]["version"] == before["baseline"]["version"] + 1
        assert final["plan_publication"]["fault_analysis"]["report"]
