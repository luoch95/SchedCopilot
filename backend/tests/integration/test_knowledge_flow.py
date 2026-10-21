"""RAG adds reference material without changing scheduling or human decisions."""

from fastapi.testclient import TestClient
from test_insertion_closure import act, assess, submit

from sched_copilot.api import create_app


def test_fault_followup_retrieves_sources_without_changing_plan(tmp_path):
    with TestClient(create_app(tmp_path / "fault.sqlite3")) as client:
        before = client.get("/api/workbench").json()
        token = dict(
            event_revision=before["event_revision"],
            baseline_fingerprint=before["baseline"]["fingerprint"],
        )
        generated = client.post(
            "/api/workflow", json={**token, "intent": "generate_candidates"}
        ).json()
        assert generated["workflow"]["status"] == "completed"
        candidates = generated["simulation"]["candidates"]
        workflow_id = generated["workflow"]["id"]
        for question, status in [
            ("M3 故障后，转机需要检查什么？", "matched"),
            ("M3 故障实际维修费用是多少？", "no_match"),
        ]:
            response = client.post(
                "/api/workflow",
                json={
                    **token,
                    "intent": "explain",
                    "workflow_id": workflow_id,
                    "question": question,
                },
            )
            assert response.status_code == 200
            body = response.json()
            assert body["workflow"]["status"] == "completed"
            knowledge = body["workflow"]["trace"][0]["knowledge"]
            assert knowledge["status"] == status
            if status == "matched":
                assert knowledge["sources"] and knowledge["items"]
                assert all(s["kind"] == "模拟演示资料" for s in knowledge["sources"])
            else:
                assert knowledge["sources"] == []
            assert body["simulation"] is None  # Follow-up reuses the saved candidate evidence.
            assert (
                body["workflow"]["results"]["scheduling"]
                == generated["workflow"]["results"]["scheduling"]
            )
            workflow_id = body["workflow"]["id"]
        assert client.get("/api/workbench").json() == before
        candidate = candidates[0]
        response = client.post(
            "/api/decisions",
            json={
                "simulation_id": generated["simulation"]["id"],
                "candidate_id": candidate["id"],
                "action": "publish",
                "reason": "验收知识解释不影响人工发布",
                "request_id": "rag-fault",
            },
        )
        assert response.status_code == 200
        assert (
            response.json()["workbench"]["baseline"]["operations"]
            == candidate["schedule"]["operations"]
        )


def test_insertion_citations_persist_and_do_not_block_approval_or_publish(tmp_path):
    path = tmp_path / "insertion.sqlite3"
    with TestClient(create_app(path)) as client:
        before = client.get("/api/workbench").json()
        record = submit(client)
        result = assess(client, record)
        knowledge = result["workflow"]["explanation"]["knowledge"]
        assert knowledge["status"] == "matched"
        assert all(s["document_id"].startswith("K-URG-") for s in knowledge["sources"])
        assert all("machine_id" not in fact for fact in knowledge["fact_catalog"].values())
        assert client.get("/api/workbench").json() == before
    with TestClient(create_app(path)) as client:
        saved = client.get(f"/api/sales/requests/{record['request_no']}").json()
        assert saved["assessment"]["workflow"]["explanation"]["knowledge"] == knowledge
        assert act(client, record, "approve", result).status_code == 200
        assert act(client, record, "publish", result).status_code == 200
        assert (
            client.get("/api/workbench").json()["baseline"]["version"]
            == before["baseline"]["version"] + 1
        )
