"""Fault approval cannot be bypassed, reused after edits, or lost on restart."""

from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from sched_copilot.api import create_app
from sched_copilot.domain.errors import RuleViolation


def test_no_candidate_assessment_can_be_reviewed_without_plan_publication(tmp_path, monkeypatch):
    def no_candidate(*args, **kwargs):
        raise RuleViolation("O1005-OP2 在 M2 需要 300 分钟，预计 00:45 完工，超过班次结束 00:00")

    monkeypatch.setattr("sched_copilot.tools.scheduling.generate_candidates", no_candidate)
    path = tmp_path / "assessment.sqlite3"
    with TestClient(create_app(path)) as client:
        before = client.get("/api/workbench").json()
        response = client.post(
            "/api/workflow",
            json={
                "event_revision": before["event_revision"],
                "baseline_fingerprint": before["baseline"]["fingerprint"],
                "intent": "generate_candidates",
            },
        )
        assert response.status_code == 200, response.text
        result = response.json()
        workflow = result["workflow"]
        assert workflow["status"] == "completed", workflow
        assert result["simulation"] is None
        assert [step["action"] for step in workflow["trace"]] == [
            "validate",
            "schedule",
            "evaluate",
            "explain",
        ]
        evaluation = workflow["results"]["evaluation"]["data"]
        assert evaluation["evaluations"] == []
        assert "00:45" in evaluation["assessment"]["findings"][0]["text"]
        assert "分析已完成" in workflow["results"]["explanation"]["data"]["summary"]
        archive = client.get(f"/api/events/{before['event_revision']}/analysis")
        assert archive.status_code == 200
        assert archive.json()["workflow"]["id"] == workflow["id"]
        url = f"/api/workflow/{workflow['id']}/review"
        submission = {
            "reason": "确认班次受限结论",
            "request_id": "assessment-review",
            "operator_role": "planner",
        }
        submitted = client.post(url, json=submission)
        assert submitted.status_code == 200, submitted.text
        review = submitted.json()["fault_review"]
        assert review["metrics"] is None
        assert client.post(url, json=submission).json()["fault_review"] == review
        action_url = f"/api/fault-reviews/{review['id']}/actions"
        action = {
            "action": "approve",
            "reason": "确认评估结果，安排补录班次",
            "operator_role": "leader",
        }
        approved = client.post(action_url, json=action)
        assert approved.status_code == 200, approved.text
        assert approved.json()["fault_review"]["status"] == "approved"
        assert approved.json()["baseline"] == before["baseline"]
        assert (
            client.post(
                "/api/decisions",
                json={
                    "simulation_id": "",
                    "candidate_id": "",
                    "action": "publish",
                    "reason": "不能发布结论",
                    "request_id": "invalid",
                },
            ).status_code
            != 200
        )
    with TestClient(create_app(path)) as client:
        state = client.get("/api/workbench").json()
        assert state["fault_review"]["status"] == "approved"
        assert state["baseline"] == before["baseline"]
        assert client.get("/api/workflow/latest").json()["workflow"]["id"] == workflow["id"]


def test_assessment_rejection_regeneration_and_system_failure(tmp_path, monkeypatch):
    def no_candidate(*args, **kwargs):
        raise RuleViolation("M2 无连续可用班次")

    monkeypatch.setattr("sched_copilot.tools.scheduling.generate_candidates", no_candidate)
    with TestClient(create_app(tmp_path / "assessment-transitions.sqlite3")) as client:
        state = client.get("/api/workbench").json()
        command = {
            "event_revision": state["event_revision"],
            "baseline_fingerprint": state["baseline"]["fingerprint"],
            "intent": "generate_candidates",
        }
        first = client.post("/api/workflow", json=command).json()["workflow"]
        submit_url = f"/api/workflow/{first['id']}/review"
        body = {"reason": "审核结论", "request_id": "first", "operator_role": "planner"}
        assert client.post(submit_url, json={**body, "operator_role": "leader"}).status_code == 422
        assert client.post(submit_url, json={**body, "reason": " "}).status_code == 409
        review = client.post(submit_url, json=body).json()["fault_review"]
        url = f"/api/fault-reviews/{review['id']}/actions"
        reject = {"action": "reject", "reason": "补充现场安排", "operator_role": "leader"}
        assert client.post(url, json=reject).json()["fault_review"]["status"] == "rejected"
        pending = client.post(submit_url, json={**body, "request_id": "resubmission"}).json()[
            "fault_review"
        ]
        second = client.post("/api/workflow", json=command).json()["workflow"]
        assert (
            client.post(
                f"/api/fault-reviews/{pending['id']}/actions", json={**reject, "action": "approve"}
            ).status_code
            == 409
        )
        assert client.post(submit_url, json={**body, "request_id": "old"}).status_code == 409
        assert (
            client.post(
                f"/api/workflow/{second['id']}/review", json={**body, "request_id": "latest"}
            ).status_code
            == 200
        )

        def crash(*args, **kwargs):
            raise RuntimeError("secret-system-error")

        monkeypatch.setattr("sched_copilot.tools.scheduling.generate_candidates", crash)
        failure = client.post("/api/workflow", json=command).json()
        assert failure["workflow"]["status"] == "failed"
        assert failure["simulation"] is None
        assert "secret-system-error" not in str(failure)
        assert (
            client.post(
                f"/api/workflow/{failure['workflow']['id']}/review",
                json={**body, "request_id": "system"},
            ).status_code
            == 409
        )


def approve_fault(client, simulation_id, candidate_id, key="approval"):
    result = client.post(
        "/api/fault-reviews",
        json={
            "simulation_id": simulation_id,
            "candidate_id": candidate_id,
            "reason": "Submit candidate for review",
            "request_id": key,
            "operator_role": "planner",
        },
    )
    assert result.status_code == 200, result.text
    review = result.json()["fault_review"]
    response = client.post(
        f"/api/fault-reviews/{review['id']}/actions",
        json={
            "action": "approve",
            "reason": "Conditions confirmed",
            "operator_role": "leader",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["fault_review"]


def generate(client):
    state = client.get("/api/workbench").json()
    result = client.post(
        "/api/workflow",
        json={
            "event_revision": state["event_revision"],
            "baseline_fingerprint": state["baseline"]["fingerprint"],
            "intent": "generate_candidates",
        },
    )
    assert result.status_code == 200, result.text
    return result.json()["simulation"]


def decision(simulation, key="publish"):
    return {
        "simulation_id": simulation["id"],
        "candidate_id": simulation["candidates"][1]["id"],
        "action": "publish",
        "reason": "Execute approved plan",
        "request_id": key,
    }


def test_review_required_and_restarted_publication_preserves_full_analysis(tmp_path):
    path = tmp_path / "review.sqlite3"
    with TestClient(create_app(path)) as client:
        simulation = generate(client)
        command = decision(simulation)
        assert client.post("/api/decisions", json=command).status_code == 409
        review = approve_fault(client, simulation["id"], command["candidate_id"])
        assert review["status"] == "approved"
    with TestClient(create_app(path)) as client:
        assert client.get("/api/workbench").json()["fault_review"]["status"] == "approved"
        published = client.post("/api/decisions", json=command)
        assert published.status_code == 200, published.text
        assert client.post("/api/decisions", json=command).json() == published.json()
        analysis = published.json()["workbench"]["plan_publication"]["fault_analysis"]
        assert len(analysis["workflow"]["trace"]) == 4
        assert set(analysis["workflow"]["results"]) >= {
            "validation",
            "scheduling",
            "evaluation",
            "explanation",
        }
        assert analysis["simulation"]["id"] == simulation["id"]
        assert analysis["simulation"]["candidates"][1]["changes"]
        assert analysis["simulation"]["candidates"][1]["order_impacts"]
        assert analysis["baseline"]["version"] == 1


def test_changed_candidate_and_regeneration_need_another_approval(tmp_path):
    with TestClient(create_app(tmp_path / "review.sqlite3")) as client:
        simulation = generate(client)
        approve_fault(client, simulation["id"], simulation["candidates"][1]["id"])
        other = {**decision(simulation), "candidate_id": simulation["candidates"][0]["id"]}
        assert client.post("/api/decisions", json=other).status_code == 409
        regenerated = generate(client)
        assert client.post("/api/decisions", json=decision(regenerated)).status_code == 409
        approve_fault(client, regenerated["id"], regenerated["candidates"][1]["id"], "revised")
        assert client.post("/api/decisions", json=decision(simulation)).status_code == 409
        assert (
            client.post("/api/decisions", json=decision(regenerated, "revised-publish")).status_code
            == 200
        )


def test_review_role_reason_and_superseded_submission(tmp_path):
    with TestClient(create_app(tmp_path / "review.sqlite3")) as client:
        simulation = generate(client)
        payload = {
            "simulation_id": simulation["id"],
            "candidate_id": simulation["candidates"][1]["id"],
            "reason": "Review",
            "request_id": "first",
            "operator_role": "planner",
        }
        assert (
            client.post(
                "/api/fault-reviews", json={**payload, "operator_role": "leader"}
            ).status_code
            == 422
        )
        first = client.post("/api/fault-reviews", json=payload).json()["fault_review"]
        assert client.post("/api/fault-reviews", json=payload).json()["fault_review"] == first
        action = {"action": "approve", "reason": "Reviewed", "operator_role": "leader"}
        url = f"/api/fault-reviews/{first['id']}/actions"
        assert client.post(url, json={**action, "operator_role": "planner"}).status_code == 422
        assert client.post(url, json={**action, "reason": "  "}).status_code == 409
        assert (
            client.post(url, json={**action, "action": "reject"}).json()["fault_review"]["status"]
            == "rejected"
        )
        assert client.post("/api/decisions", json=decision(simulation)).status_code == 409
        client.post("/api/fault-reviews", json={**payload, "request_id": "second"})
        assert client.post(url, json=action).status_code == 409


def test_parallel_publications_only_advance_one_version(tmp_path):
    with TestClient(create_app(tmp_path / "review.sqlite3")) as client:
        simulation = generate(client)
        approve_fault(client, simulation["id"], simulation["candidates"][1]["id"])
        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(
                executor.map(
                    lambda key: client.post("/api/decisions", json=decision(simulation, key)),
                    ["one", "two"],
                )
            )
        assert sorted(r.status_code for r in responses) == [200, 409]
        assert client.get("/api/workbench").json()["baseline"]["version"] == 2
