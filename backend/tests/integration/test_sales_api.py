from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from sched_copilot.api import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "sales.sqlite3")) as app:
        yield app


def test_sales_overview_is_an_order_only_projection_and_does_not_mutate_plan(client):
    before = client.get("/api/workbench").json()
    response = client.get("/api/sales/overview")
    assert response.status_code == 200
    data = response.json()
    assert set(data) == {
        "plan_version",
        "plan_fingerprint",
        "snapshot_time",
        "source",
        "products",
        "product_source",
        "orders",
    }
    assert data["plan_version"] == before["baseline"]["version"]
    assert data["plan_fingerprint"] == before["baseline"]["fingerprint"]
    assert len(data["orders"]) == len(before["orders"])
    for row in data["orders"]:
        assert set(row) == {"id", "name", "due", "planned_completion", "lateness_minutes"}
        ends = [
            datetime.fromisoformat(op["end"])
            for op in before["baseline"]["operations"]
            if op["order_id"] == row["id"]
        ]
        assert datetime.fromisoformat(row["planned_completion"]) == max(ends)
    for product in data["products"]:
        assert set(product) == {
            "id",
            "name",
            "material",
            "units_per_cycle",
            "cycle_seconds",
            "buffer_percent",
        }
    assert "模拟" in data["product_source"]
    assert client.get("/api/workbench").json() == before


def test_processing_estimate_reports_buffer_and_rounds_final_sum_without_scheduling(
    client, monkeypatch
):
    def forbidden(*args, **kwargs):
        raise AssertionError("A processing estimate must not execute the Agent workflow")

    monkeypatch.setattr(client.app.state.workbench, "run_workflow", forbidden)
    before = client.get("/api/workbench").json()
    response = client.post(
        "/api/sales/processing-estimate", json={"product_id": "P-DEMO-001", "quantity": 1001}
    )
    assert response.status_code == 200
    result = response.json()
    assert result["cycles"] == 501
    assert result["theoretical_seconds"] == 22545
    assert result["buffer_seconds"] == 2254.5
    assert result["buffer_percent"] == 10
    assert result["planned_minutes"] == 414
    assert set(result) == {
        "product_id",
        "quantity",
        "cycles",
        "theoretical_seconds",
        "buffer_percent",
        "buffer_seconds",
        "planned_minutes",
        "source",
    }
    assert client.get("/api/workbench").json() == before


@pytest.mark.parametrize("quantity", [0, -1, 1.5, "100", True, 1000001])
def test_processing_estimate_rejects_invalid_quantities(client, quantity):
    assert (
        client.post(
            "/api/sales/processing-estimate",
            json={"product_id": "P-DEMO-001", "quantity": quantity},
        ).status_code
        == 422
    )


def test_unknown_products_and_client_supplied_processing_parameters_are_rejected(client):
    assert (
        client.post(
            "/api/sales/processing-estimate", json={"product_id": "unknown", "quantity": 10}
        ).status_code
        != 200
    )
    assert (
        client.post(
            "/api/sales/processing-estimate",
            json={"product_id": "P-DEMO-001", "quantity": 10, "buffer_percent": 0},
        ).status_code
        == 422
    )
