import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from fastapi.testclient import TestClient

from sched_copilot.api import create_app
from sched_copilot.application.metrics import read_metrics
from sched_copilot.infrastructure.metrics import metric_records
from sched_copilot.infrastructure.visits import VisitStore


def test_local_proxy_deduplication_and_restart_preserve_business_data(tmp_path):
    path = tmp_path / "visits.sqlite3"
    app = create_app(path)
    with sqlite3.connect(path) as db:
        before = db.execute("SELECT payload FROM current_plan").fetchall()
    with TestClient(app, client=("127.0.0.1", 1234)) as client:
        assert client.get("/api/visits").status_code == 204
        client.get("/api/visits")
        client.get("/api/visits", headers={"X-Forwarded-For": "203.0.113.7, 10.0.0.1"})
        client.get("/api/visits", headers={"X-Forwarded-For": "invalid"})
        client.get("/api/visits", headers={"X-Forwarded-For": "::ffff:203.0.113.7"})
        client.get("/api/visits", headers={"X-Forwarded-For": "2001:db8::1"})
        client.get("/api/reports/weekly", headers={"X-Forwarded-For": "203.0.113.99"})
        client.get("/assets/missing.js", headers={"X-Forwarded-For": "203.0.113.99"})
    create_app(path)
    with sqlite3.connect(path) as db:
        assert {r[0] for r in db.execute("SELECT ip FROM daily_visitors")} == {
            "127.0.0.1",
            "203.0.113.7",
            "2001:db8::1",
        }
        assert db.execute("SELECT payload FROM current_plan").fetchall() == before


def test_daily_uv_is_concurrent_unique_and_respects_week_boundary(tmp_path):
    path = tmp_path / "visits.sqlite3"
    create_app(path)
    store = VisitStore(path)
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda _: store.record("203.0.113.1", "2026-10-19"), range(12)))
    store.record("203.0.113.1", "2026-10-18")
    store.record("203.0.113.2", "2026-10-19")
    records = metric_records(path)
    now = datetime.fromisoformat("2026-10-18T16:00:01+00:00")  # Monday in Beijing
    assert read_metrics(records, now=now)["visits"]["total"] == 3
    assert read_metrics(records, weekly=True, now=now)["visits"]["total"] == 2


def test_middleware_records_beijing_date(tmp_path, monkeypatch):
    class Clock:
        @staticmethod
        def now(tz):
            return datetime.fromisoformat("2026-10-18T16:00:01+00:00").astimezone(tz)

    monkeypatch.setattr("sched_copilot.api.visits.datetime", Clock)
    path = tmp_path / "visits.sqlite3"
    with TestClient(create_app(path), client=("127.0.0.1", 1234)) as client:
        client.get("/api/visits")
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT visit_date FROM daily_visitors").fetchall() == [("2026-10-19",)]


def test_analytics_write_failure_does_not_break_response(tmp_path):
    path = tmp_path / "visits.sqlite3"
    app = create_app(path)
    with sqlite3.connect(path) as db:
        db.execute("DROP TABLE daily_visitors")
    with TestClient(app, client=("127.0.0.1", 1234)) as client:
        assert client.get("/api/visits").status_code == 204


def test_visitor_details_require_session_and_support_pagination_and_exclusion(tmp_path):
    app = create_app(tmp_path / "visitors.sqlite3")
    store = app.state.visits
    store.record("203.0.113.1", "2026-10-28")
    store.record("203.0.113.1", "2026-10-29")
    store.record("203.0.113.2", "2026-10-29")
    with TestClient(app, client=("203.0.113.1", 1234)) as client:
        assert client.get("/api/admin/visitors").status_code == 403
        client.post("/api/demo/login", json={"password": app.state.settings.demo_admin_password})
        response = client.get("/api/admin/visitors?page_size=1")
        assert response.headers["cache-control"] == "no-store"
        data = response.json()
        assert data["total"] == 3
        assert data["items"] == [
            {"visit_date": "2026-10-29", "ip": "203.0.113.1", "matches_current_ip": True}
        ]
        second = client.get("/api/admin/visitors?page_size=1&page=2").json()
        assert second["items"][0]["ip"] == "203.0.113.2"
        filtered = client.get("/api/admin/visitors?exclude_current=true").json()
        assert filtered["total"] == 1
        assert filtered["items"][0]["matches_current_ip"] is False
        assert client.get("/api/admin/visitors?page=0").status_code == 422
        assert client.get("/api/admin/visitors?page_size=101").status_code == 422
        client.post("/api/demo/logout")
        assert client.get("/api/admin/visitors").status_code == 403
    with sqlite3.connect(store.path) as db:
        assert db.execute("SELECT COUNT(*) FROM daily_visitors").fetchone()[0] == 3
