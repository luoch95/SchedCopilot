import json
import sqlite3
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from sched_copilot.api import create_app
from sched_copilot.application.metrics import read_metrics
from sched_copilot.infrastructure.metrics import metric_records


def test_admin_requires_server_session_even_outside_demo(tmp_path):
    app = create_app(tmp_path / "metrics.sqlite3")
    with TestClient(app) as client:
        assert client.get("/api/admin/metrics").status_code == 403
        assert client.get("/api/reports/weekly").status_code == 200
        assert client.post("/api/demo/login", json={"password": "wrong"}).status_code == 401
        client.post("/api/demo/login", json={"password": app.state.settings.demo_admin_password})
        response = client.get("/api/admin/metrics")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert response.json()["visits"]["source"] == "daily_ip_uv"
        client.post("/api/demo/logout")
        assert client.get("/api/admin/metrics").status_code == 403


def test_week_boundaries_generation_fallback_and_read_only(tmp_path):
    path = tmp_path / "metrics.sqlite3"
    create_app(path)

    def workflow(intent="generate_candidates", status="completed", candidates=True, trace=None):
        return dict(
            intent=intent,
            status=status,
            trace=trace or [],
            results={"scheduling": {"data": {"candidates": [{}] if candidates else []}}},
        )

    rows = [
        ("2026-10-18T15:59:59+00:00", workflow()),  # Before Monday in Beijing.
        ("2026-10-18T16:00:00+00:00", workflow()),
        ("2026-10-19T01:00:00", workflow("validate")),  # Naive SQLite UTC.
        ("2026-10-19T02:00:00Z", workflow(status="failed", candidates=False)),
        (
            "2026-10-19T03:00:00Z",
            workflow(trace=[{"execution": None}, {"execution": {"mode": "rules"}}]),
        ),
        ("2026-10-19T04:00:00Z", workflow(trace=[{"execution": {"mode": "fallback"}}] * 2)),
        (
            "2026-10-19T05:00:00Z",
            workflow(trace=[{"execution": {"mode": "fallback", "simulated": True}}]),
        ),
        (
            "2026-10-19T06:00:00Z",
            dict(
                intent="generate_candidates",
                status="completed",
                trace=[],
                results={
                    "evaluation": {"data": {"assessment": {"outcome": "no_feasible_candidate"}}}
                },
            ),
        ),
    ]
    with sqlite3.connect(path) as db:
        for index, (created, payload) in enumerate(rows):
            db.execute(
                "INSERT INTO workflow_runs(trace_id,workflow_id,created_at,payload,state) "
                "VALUES(?,?,?,?,?)",
                (str(index), str(index), created, json.dumps(payload), "{}"),
            )
    before = path.read_bytes()
    result = read_metrics(
        metric_records(path), weekly=True, now=datetime.fromisoformat("2026-10-20T12:00:00+08:00")
    )
    assert result["ai"] == dict(
        generated=4,
        adopted=0,
        published=0,
        failed=1,
        degraded=1,
        risk_interceptions=1,
        adoption_rate=None,
    )
    assert result["trend"] == [
        dict(label="10-19", generated=4, published=0),
        dict(label="10-20", generated=0, published=0),
    ]
    assert result["capacity_saved_minutes"] is None
    assert path.read_bytes() == before


def test_missing_database_does_not_create_or_return_fake_zeros(tmp_path):
    path = tmp_path / "missing.sqlite3"
    with pytest.raises(sqlite3.OperationalError):
        metric_records(path)
    assert not path.exists()


def test_admin_direct_route_serves_frontend(tmp_path):
    frontend = tmp_path / "frontend"
    (frontend / "assets").mkdir(parents=True)
    (frontend / "index.html").write_text("<h1>app</h1>")
    with TestClient(create_app(tmp_path / "db.sqlite3", frontend_dir=frontend)) as client:
        assert client.get("/admin").text == "<h1>app</h1>"
