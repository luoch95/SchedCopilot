"""Manual recovery never writes an execution plan or reuses an edited approval."""

from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from sched_copilot.api import create_app
from sched_copilot.domain.errors import RuleViolation


def analyze(client):
    state = client.get("/api/workbench").json()
    response = client.post(
        "/api/workflow",
        json={
            "event_revision": state["event_revision"],
            "baseline_fingerprint": state["baseline"]["fingerprint"],
            "intent": "generate_candidates",
        },
    )
    assert response.status_code == 200, response.text
    return state, response.json()


def create(client, result, source=True):
    command = {"workflow_id": result["workflow"]["id"], "operator_role": "planner"}
    if source:
        command.update(
            simulation_id=result["simulation"]["id"],
            candidate_id=result["simulation"]["candidates"][0]["id"],
        )
    response = client.post("/api/fault-drafts", json=command)
    assert response.status_code == 200, response.text
    return response.json()


def confirm(client, draft):
    response = client.post(
        f"/api/fault-drafts/{draft['id']}/confirm", json={"revision": draft["revision"]}
    )
    assert response.status_code == 200, response.text
    return response.json()


def submit(client, draft, key="submit"):
    simulation = draft["simulation"]
    response = client.post(
        "/api/fault-reviews",
        json={
            "simulation_id": simulation["id"],
            "candidate_id": simulation["candidates"][0]["id"],
            "reason": "核对人工调整与延期风险",
            "request_id": key,
            "operator_role": "planner",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["fault_review"]


def approve(client, review):
    response = client.post(
        f"/api/fault-reviews/{review['id']}/actions",
        json={
            "action": "approve",
            "reason": "确认交期取舍",
            "operator_role": "leader",
        },
    )
    assert response.status_code == 200, response.text


def publish(client, draft):
    return client.post(
        "/api/decisions",
        json={
            "simulation_id": draft["simulation"]["id"],
            "candidate_id": draft["simulation"]["candidates"][0]["id"],
            "action": "publish",
            "reason": "批准范围内发布",
            "request_id": "publish-manual",
        },
    )


def test_manual_report_approval_publish_restart_and_idempotency(tmp_path):
    path = tmp_path / "manual.sqlite3"
    with TestClient(create_app(path)) as client:
        state, result = analyze(client)
        draft = create(client, result)
        # Move from one valid deterministic candidate to the other, recording real edits.
        target = result["simulation"]["candidates"][-1]["schedule"]["operations"]
        moves = [
            {"operation_id": op["id"], "machine_id": op["machine_id"], "start": op["start"]}
            for op in target
            if op["status"] == "planned"
        ]
        saved = client.put(
            f"/api/fault-drafts/{draft['id']}",
            json={
                "revision": 1,
                "moves": moves,
                "reason": "人工选择转机安排",
            },
        )
        assert saved.status_code == 200, saved.text
        draft = confirm(client, saved.json())
        assert draft["report"]["edits"]
        assert draft["report"]["model"]["mode"] == "fallback"
        assert "规则报告" in draft["report"]["model_work"]
        assert client.get("/api/workbench").json()["baseline"] == state["baseline"]
        assert publish(client, draft).status_code == 409
        review = submit(client, draft)
        assert review["analysis"]["report"] == draft["report"]
        approve(client, review)
        assert client.get("/api/workbench").json()["baseline"] == state["baseline"]
    with TestClient(create_app(path)) as client:
        restored = client.get("/api/fault-drafts/latest").json()
        assert restored["report"] == draft["report"]
        assert restored["simulation"] == draft["simulation"]
        response = publish(client, restored)
        assert response.status_code == 200, response.text
        final = response.json()["workbench"]
        assert final["baseline"]["version"] == state["baseline"]["version"] + 1
        assert final["plan_publication"]["fault_analysis"]["report"] == draft["report"]
        assert final["plan_publication"]["fault_analysis"]["decisions"]["status"] == "published"
        assert publish(client, restored).json()["plan_version"] == final["baseline"]["version"]


def test_edit_invalidates_approval_conflicts_and_optimistic_revision(tmp_path):
    with TestClient(create_app(tmp_path / "edit.sqlite3")) as client:
        _, result = analyze(client)
        draft = confirm(client, create(client, result))
        review = submit(client, draft)
        approve(client, review)
        op = next(o for o in draft["schedule"]["operations"] if o["status"] == "planned")
        move = {
            "operation_id": op["id"],
            "machine_id": op["machine_id"],
            "start": (datetime.fromisoformat(op["start"]) + timedelta(days=10)).isoformat(),
        }
        body = {"revision": draft["revision"], "moves": [move], "reason": "越出已知班次"}
        url = f"/api/fault-drafts/{draft['id']}"
        response = client.put(url, json=body)
        assert response.status_code == 200, response.text
        assert response.json()["issues"]
        assert response.json()["report"] is None
        assert client.get("/api/workbench").json()["fault_review"]["status"] == "superseded"
        assert publish(client, draft).status_code == 409
        assert client.put(url, json=body).status_code == 409
        invalid = client.post(url + "/confirm", json={"revision": response.json()["revision"]})
        assert invalid.status_code == 409
        assert client.get(url).json()["status"] == "editing"
        assert (
            client.put(
                url, json={"revision": 2, "moves": [], "operator_role": "leader"}
            ).status_code
            == 422
        )


def test_no_candidate_can_be_resolved_manually(tmp_path, monkeypatch):
    with TestClient(create_app(tmp_path / "no-candidate.sqlite3")) as client:
        state, valid = analyze(client)

        def no_candidate(*args, **kwargs):
            raise RuleViolation("当前班次无法容纳故障段工序")

        monkeypatch.setattr("sched_copilot.tools.scheduling.generate_candidates", no_candidate)
        _, result = analyze(client)
        assert result["simulation"] is None
        draft = create(client, result, source=False)
        assert draft["origin"]["fingerprint"] == state["baseline"]["fingerprint"]
        assert (
            client.post(
                f"/api/fault-drafts/{draft['id']}/confirm", json={"revision": 1}
            ).status_code
            == 409
        )
        target = valid["simulation"]["candidates"][-1]["schedule"]["operations"]
        response = client.put(
            f"/api/fault-drafts/{draft['id']}",
            json={
                "revision": 1,
                "moves": [
                    {"operation_id": op["id"], "machine_id": op["machine_id"], "start": op["start"]}
                    for op in target
                    if op["status"] == "planned"
                ],
            },
        )
        assert response.status_code == 200, response.text
        draft = confirm(client, response.json())
        assert draft["report"]["source_candidate_id"] is None
        assert "仅对比执行计划" in draft["report"]["comparison"]
        approve(client, submit(client, draft))
        assert publish(client, draft).status_code == 200


def test_followup_analysis_supports_manual_drafts_but_validation_alone_does_not(tmp_path):
    with TestClient(create_app(tmp_path / "followup.sqlite3")) as client:
        state, result = analyze(client)
        for intent in ("explain", "re_evaluate"):
            response = client.post(
                "/api/workflow",
                json={
                    "event_revision": state["event_revision"],
                    "baseline_fingerprint": state["baseline"]["fingerprint"],
                    "intent": intent,
                    "workflow_id": result["workflow"]["id"],
                },
            )
            assert response.status_code == 200, response.text
            followup = response.json()
            followup["simulation"] = followup["simulation"] or result["simulation"]
            result = followup
            draft = create(client, result)
            assert draft["source_candidate_id"] == result["simulation"]["candidates"][0]["id"]
        response = client.post(
            "/api/workflow",
            json={
                "event_revision": state["event_revision"],
                "baseline_fingerprint": state["baseline"]["fingerprint"],
                "intent": "validate",
            },
        )
        assert response.status_code == 200
        rejected = client.post(
            "/api/fault-drafts",
            json={
                "workflow_id": response.json()["workflow"]["id"],
            },
        )
        assert rejected.status_code == 409


def test_started_operations_and_stale_input_cannot_be_manually_overridden(tmp_path):
    with TestClient(create_app(tmp_path / "stale.sqlite3")) as client:
        state, result = analyze(client)
        draft = create(client, result)
        op = next(o for o in draft["schedule"]["operations"] if o["status"] != "planned")
        response = client.put(
            f"/api/fault-drafts/{draft['id']}",
            json={
                "revision": 1,
                "moves": [
                    {"operation_id": op["id"], "machine_id": op["machine_id"], "start": op["start"]}
                ],
            },
        )
        assert response.status_code == 409
        changed = client.put(
            "/api/event",
            json={
                "event_revision": state["event_revision"],
                "baseline_fingerprint": state["baseline"]["fingerprint"],
                **{k: v for k, v in state["event"].items() if k != "received_at"},
                "source": "updated fault",
            },
        )
        assert changed.status_code == 200, changed.text
        assert client.get("/api/fault-drafts/latest").json() is None
        assert (
            client.post(
                f"/api/fault-drafts/{draft['id']}/confirm", json={"revision": 1}
            ).status_code
            == 409
        )
