"""Tracing is diagnostic: preserve authority, failures, privacy and admin access."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from sched_copilot.api import create_app
from sched_copilot.application.telemetry import bind, observed, span
from sched_copilot.bootstrap import build_orchestrator
from sched_copilot.infrastructure.telemetry import TraceExporter
from sched_copilot.telemetry_wiring import ModelProbe


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv("SCHED_DEMO_MODE", "0")
    monkeypatch.setenv("SCHED_WORKFLOW_MODEL_MODE", "rules")
    monkeypatch.setenv("SCHED_TRACING_ENABLED", "0")
    app = create_app(tmp_path / "trace.sqlite3")
    with TestClient(app) as client:
        yield app, client


def login(app, client):
    client.post("/api/demo/login", json={"password": app.state.settings.demo_admin_password})


def fault(client):
    before = client.get("/api/workbench").json()
    response = client.post(
        "/api/workflow",
        json={
            "baseline_fingerprint": before["baseline"]["fingerprint"],
            "event_revision": before["event_revision"],
            "intent": "generate_candidates",
            "question": "SECRET_USER_INPUT",
        },
    )
    assert response.status_code == 200, response.text
    return before, response.json()


def insertion(client):
    overview = client.get("/api/sales/overview").json()
    start = datetime.fromisoformat(overview["snapshot_time"])
    draft = client.post(
        "/api/sales/requests",
        json={
            "product_id": "P-DEMO-001",
            "quantity": 100,
            "earliest_start_at": start.isoformat(),
            "requested_due_at": (start + timedelta(days=1)).isoformat(),
            "reason": "SECRET_REASON",
            "submission_key": str(uuid4()),
            "draft_only": True,
        },
    ).json()
    return draft, client.post(f"/api/sales/requests/{draft['request_no']}/assessment", json={})


def test_real_workflows_local_history_privacy_and_access(setup):
    app, client = setup
    assert client.get("/api/admin/traces").status_code == 403
    before, result = fault(client)
    draft, response = insertion(client)
    assert response.status_code == 200, response.text
    login(app, client)
    page = client.get("/api/admin/traces").json()
    assert page["total"] == 2
    assert "SECRET_" not in str(page)
    assert client.get("/api/admin/traces").headers["cache-control"] == "no-store"
    record = client.get("/api/admin/traces?kind=fault").json()["items"][0]
    assert record["workflow_id"] == result["workflow"]["id"]
    assert record["input_fingerprint"] == result["workflow"]["context"]["input_fingerprint"]
    assert record["status"] == result["workflow"]["status"]
    assert record["upload_status"] == "disabled"
    assert record["input_tokens"] is None
    assert {n["name"] for n in record["spans"]} >= {
        "validation",
        "scheduling",
        "evaluation",
        "explanation",
        "saving",
        "scheduling_tool",
    }
    record = client.get("/api/admin/traces?kind=insertion").json()["items"][0]
    assert record["business_id"] == draft["request_no"]
    assert record["assessment_id"] == response.json()["assessment_id"]
    assert record["local_trace_id"] == response.json()["workflow"]["trace_id"]
    assert client.get(f"/api/admin/traces/{record['id']}").json() == record
    assert client.get(f"/api/admin/traces/{uuid4()}").status_code == 404
    assert client.get("/api/admin/traces?start=2026-11-01&end=2026-10-01").status_code == 422
    assert client.get("/api/admin/traces?start=2099-01-01").json()["total"] == 0
    assert client.get("/api/admin/traces?page=0").status_code == 422
    assert client.get("/api/admin/traces?status=failed").json()["total"] == 0
    assert client.get("/api/workbench").json()["baseline"] == before["baseline"]
    client.post("/api/demo/logout")
    assert client.get(f"/api/admin/traces/{record['id']}").status_code == 403


def test_saving_failure_and_diagnostic_store_failure_do_not_fake_success(setup, monkeypatch):
    app, client = setup
    monkeypatch.setattr(
        app.state.sales_requests.repository,
        "save_assessment",
        lambda *a: (_ for _ in ()).throw(ValueError("SECRET_DATABASE_ERROR")),
    )
    with pytest.raises(ValueError, match="SECRET_DATABASE_ERROR"):
        insertion(client)
    record = app.state.telemetry.store.records()["items"][0]
    assert record["status"] == "failed"
    assert next(n for n in record["spans"] if n["name"] == "saving")["status"] == "failed"
    assert "SECRET_DATABASE_ERROR" not in str(record)
    monkeypatch.setattr(
        app.state.telemetry, "record", lambda *a: (_ for _ in ()).throw(RuntimeError("unavailable"))
    )
    fault(client)  # Diagnostic persistence failure does not replace a valid business result.


def test_export_parentage_upload_failure_and_redaction(setup):
    app, client = setup
    fault(client)
    original = app.state.telemetry.store.records()["items"][0]
    sent = []

    class FakeClient:
        def __init__(self, **kwargs):
            assert kwargs["auto_batch_tracing"] is False

        def create_run(self, **kwargs):
            sent.append(kwargs)

        def read_run(self, run_id):
            return SimpleNamespace(id=run_id)

        def get_run_url(self, **kwargs):
            return "https://smith.langchain.com/test-trace"

    exporter = TraceExporter(
        app.state.telemetry.store, enabled=True, api_key="SECRET_KEY", client_factory=FakeClient
    )
    exporter.record(original)
    exporter.queue.join()
    saved = exporter.store.detail(original["id"])
    assert saved["upload_status"] == "uploaded"
    assert "SECRET_" not in str(sent)
    assert len(sent) == len(original["spans"]) + 1
    assert sent[0]["parent_run_id"] is None
    assert all(str(node["trace_id"]) == original["id"] for node in sent)
    assert all(node["inputs"] == {} for node in sent)
    assert any(node["run_type"] == "tool" for node in sent)

    class BrokenClient(FakeClient):
        def create_run(self, **kwargs):
            raise RuntimeError("SECRET_PROVIDER_ERROR")

    exporter.client_factory = BrokenClient
    exporter.record(original)
    exporter.queue.join()
    saved = exporter.store.detail(original["id"])
    assert saved["upload_status"] == "failed"
    assert saved["status"] == "completed"
    assert "langsmith_url" not in saved
    assert "SECRET_" not in str(saved)


def test_context_isolation_and_model_token_measurement():
    records = []

    class Service:
        telemetry = SimpleNamespace(record=records.append)

        @observed("fault")
        def execute(self, identity):
            bind(business_id=identity)
            with span("validation"):
                model = ModelProbe(
                    SimpleNamespace(
                        invoke=lambda *a, **k: SimpleNamespace(
                            usage_metadata={"input_tokens": 7, "output_tokens": 3}
                        )
                    ),
                    "test-model",
                )
                model.invoke("SECRET_PROMPT")

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(Service().execute, ["one", "two", "three", "four"]))
    assert {r["business_id"] for r in records} == {"one", "two", "three", "four"}
    assert len({r["id"] for r in records}) == 4
    for record in records:
        assert len(record["spans"]) == 2
        assert record["input_tokens"] == 7
        assert record["output_tokens"] == 3
        assert record["mode"] == "live"
        model, role = record["spans"]
        assert model["parent_id"] == role["id"]
        assert "SECRET_" not in str(record)


def test_model_timeout_preserves_rule_results_and_records_fallback(setup):
    app, client = setup

    class TimeoutModel:
        def bind_tools(self, *args, **kwargs):
            return self

        def invoke(self, *args, **kwargs):
            raise TimeoutError("SECRET_PROVIDER_RESPONSE")

    app.state.workbench.workflow_runner.orchestrator = build_orchestrator(
        replace(app.state.settings, workflow_model_mode="live"),
        model_factory=TimeoutModel,
    )
    fault(client)
    record = app.state.telemetry.store.records()["items"][0]
    assert record["status"] == "completed"
    assert record["mode"] == "fallback"
    assert record["model_calls"] > 0
    assert record["input_tokens"] is None
    assert any(n.get("error_code") == "MODEL_TIMEOUT" for n in record["spans"])
    assert "SECRET_" not in str(record)


def test_saturated_upload_queue_does_not_block_business(setup):
    app, client = setup
    exporter = TraceExporter(app.state.telemetry.store, enabled=True, api_key="test-key")
    for _ in range(exporter.queue.maxsize):
        exporter.queue.put_nowait(object())
    app.state.workbench.telemetry = exporter
    fault(client)
    record = exporter.store.records()["items"][0]
    assert record["status"] == "completed"
    assert record["upload_status"] == "queue_full"
    assert exporter.worker is None


def test_missing_key_old_history_and_pagination(setup):
    app, client = setup
    login(app, client)
    assert client.get("/api/admin/traces").json()["total"] == 0
    exporter = TraceExporter(app.state.telemetry.store, enabled=True)
    app.state.workbench.telemetry = exporter
    fault(client)
    record = exporter.store.records()["items"][0]
    assert record["upload_status"] == "not_configured"
    for _ in range(20):
        exporter.store.save({**record, "id": str(uuid4())})
    first = client.get("/api/admin/traces").json()
    second = client.get("/api/admin/traces?page=2").json()
    assert first["total"] == 21
    assert len(first["items"]) == 20
    assert len(second["items"]) == 1
    assert second["items"][0]["id"] not in {r["id"] for r in first["items"]}


def test_real_sdk_serializes_only_sanitized_runs(setup):
    import json

    from langsmith import Client
    from requests import Response

    app, client = setup
    fault(client)
    record = app.state.telemetry.store.records()["items"][0]
    sent = []

    class RecordingClient(Client):
        def request_with_retries(self, method, pathname, **kwargs):
            sent.append(json.loads(kwargs["request_kwargs"]["data"]))
            response = Response()
            response.status_code = 200
            response._content = b"{}"
            return response

        def read_run(self, run_id):
            return SimpleNamespace(id=run_id)

        def get_run_url(self, **kwargs):
            return "https://smith.langchain.com/private-run"

    exporter = TraceExporter(
        app.state.telemetry.store,
        enabled=True,
        api_key="SECRET_KEY",
        client_factory=RecordingClient,
    )
    exporter._upload(record)
    assert len(sent) == len(record["spans"]) + 1
    assert all(node["inputs"] == {} for node in sent)
    assert "SECRET_" not in str(sent)
    assert all(node["trace_id"] == record["id"] for node in sent)
