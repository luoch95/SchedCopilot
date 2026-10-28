from fastapi.testclient import TestClient

from sched_copilot.api import create_app


def test_workbench_is_an_overview_without_analysis_bodies(tmp_path):
    with TestClient(create_app(tmp_path / "overview.sqlite3")) as client:
        _assert_overview(client)


def _assert_overview(client):
    response = client.get("/api/workbench")
    assert response.status_code == 200
    data = response.json()
    assert "baseline" in data
    assert "event" in data
    assert "plan_publication" in data
    publication = data["plan_publication"]
    assert "fault_analysis" not in publication
    assert "current_fault_analysis" not in publication
    review = data.get("fault_review") or {}
    assert "analysis" not in review
    assert "workflow" not in review
    assert "assessment" not in review


def test_event_analysis_remains_a_separate_detail_endpoint(tmp_path):
    with TestClient(create_app(tmp_path / "detail.sqlite3")) as client:
        state = client.get("/api/workbench").json()
        response = client.get(f"/api/events/{state['event_revision']}/analysis")
        assert response.status_code == 200
