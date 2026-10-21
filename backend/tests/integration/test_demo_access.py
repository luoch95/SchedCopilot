"""The fixed preview and login-free demo write requests."""

import pytest
from fastapi.testclient import TestClient

from sched_copilot.api import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SCHED_DEMO_MODE", "1")
    monkeypatch.setenv("SCHED_DEMO_ADMIN_PASSWORD", "admin123")
    with TestClient(create_app(tmp_path / "preview.sqlite3")) as client:
        yield client


def assert_preview(client):
    snapshot = client.get("/api/workbench").json()
    assert snapshot["event_revision"] == 2
    assert snapshot["baseline"]["version"] == 1
    saved = client.get("/api/workflow/latest").json()
    assert saved["workflow"]["status"] == "completed"
    assert [item["action"] for item in saved["workflow"]["trace"]] == [
        "validate",
        "schedule",
        "evaluate",
        "explain",
    ]
    assert [
        item["metrics"]["total_lateness_minutes"] for item in saved["simulation"]["candidates"]
    ] == [255, 45]
    requests = client.get("/api/sales/requests").json()
    assert len(requests) == 1
    assert requests[0]["status"] == "pending_approval"
    assert requests[0]["assessment"]
    return saved


def login(client):
    assert client.post("/api/demo/login", json={"password": "admin123"}).status_code == 200
    client.headers["X-Demo-Write"] = "1"


def test_startup_is_complete_and_read_only(client):
    assert client.get("/api/demo/session").json() == {"admin": False, "read_only": True}
    assert_preview(client)


@pytest.mark.parametrize(
    "method,path",
    [
        ("PUT", "/api/event"),
        ("POST", "/api/event/recover"),
        ("POST", "/api/simulations"),
        ("POST", "/api/decisions"),
        ("POST", "/api/analysis"),
        ("POST", "/api/workflow"),
        ("POST", "/api/sales/requests"),
        ("POST", "/api/sales/requests/missing/assessment"),
        ("POST", "/api/sales/requests/missing/actions"),
        ("POST", "/api/demo/reset"),
    ],
)
def test_writes_without_explicit_header_are_rejected(client, method, path):
    client.cookies.set("sched_demo_admin", "forged")
    response = client.request(method, path, json={})
    assert response.status_code == 403
    assert response.json()["detail"] == "演示模式：无操作权限"


def test_admin_publishes_then_resets_and_logs_out(client):
    saved = assert_preview(client)
    assert client.post("/api/demo/login", json={"password": "wrong"}).status_code == 401
    login(client)
    assert client.get("/api/demo/session").json() == {"admin": True, "read_only": False}
    simulation = saved["simulation"]
    response = client.post(
        "/api/decisions",
        json={
            "simulation_id": simulation["id"],
            "candidate_id": simulation["candidates"][1]["id"],
            "action": "publish",
            "reason": "管理员发布预置方案",
            "request_id": "demo-publish",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["plan_version"] == 2
    for _ in range(2):
        assert client.post("/api/demo/reset").status_code == 200
        assert_preview(client)
    assert client.post("/api/demo/logout").status_code == 200
    client.headers.pop("X-Demo-Write")
    assert client.post("/api/demo/reset").status_code == 403


def test_frontend_can_approve_and_publish_without_authentication(client):
    client.headers["X-Demo-Write"] = "1"
    record = client.get("/api/sales/requests").json()[0]
    path = f"/api/sales/requests/{record['id']}/actions"
    response = client.post(
        path,
        json={
            "action": "approve",
            "operator_role": "leader",
            "reason": "同意插单",
            "assessment_id": record["assessment"]["assessment_id"],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "approved"
    response = client.post(
        path,
        json={
            "action": "publish",
            "operator_role": "planner",
            "reason": "复核后发布",
            "assessment_id": record["assessment"]["assessment_id"],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "published"


def test_admin_writes_require_explicit_header(client):
    login(client)
    del client.headers["X-Demo-Write"]
    assert client.post("/api/demo/reset").status_code == 403


def test_admin_can_estimate_and_complete_a_new_request_from_preset(client):
    login(client)
    preset = client.get("/api/sales/requests").json()[0]
    estimate = client.post(
        "/api/sales/processing-estimate",
        json={"product_id": preset["product_id"], "quantity": preset["quantity"]},
    )
    assert estimate.status_code == 200, estimate.text
    assert estimate.json()["planned_minutes"] > 0
    created = client.post(
        "/api/sales/requests",
        json={
            **{
                key: preset[key]
                for key in (
                    "product_id",
                    "quantity",
                    "earliest_start_at",
                    "requested_due_at",
                    "reason",
                )
            },
            "submission_key": "preset-form-demo",
        },
    )
    assert created.status_code == 201, created.text
    record = created.json()
    assert record["request_no"] != preset["request_no"]
    result = client.post(f"/api/sales/requests/{record['request_no']}/assessment")
    assert result.status_code == 200, result.text
    for action, role in (("approve", "leader"), ("publish", "planner")):
        response = client.post(
            f"/api/sales/requests/{record['request_no']}/actions",
            json={
                "action": action,
                "operator_role": role,
                "reason": "演示闭环复核",
                "assessment_id": result.json()["assessment_id"],
            },
        )
        assert response.status_code == 200, response.text
    assert response.json()["status"] == "published"
    overview = client.get("/api/sales/overview").json()
    assert any(o["display_name"] == record["request_no"] for o in overview["orders"])
