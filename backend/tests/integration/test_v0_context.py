import json
import sqlite3
from dataclasses import asdict
from pathlib import Path

import pytest
from pydantic import ValidationError

from sched_copilot.bootstrap import build_workbench
from sched_copilot.config import Settings
from sched_copilot.domain.insertion import trial_insertion, validate_insertion
from sched_copilot.infrastructure.sqlite_repository import DecisionStore
from sched_copilot.scenarios.demo import EVENT_TIME, demo_machines, demo_orders, demo_schedule
from sched_copilot.scenarios.insertion_demo import demo_routes, insertion_resources
from sched_copilot.scenarios.v0 import v0_data


def seed_v0(path):
    plan, orders, clock, production = v0_data()
    store = DecisionStore(path, plan)
    store.seed_production_inputs(production)
    with sqlite3.connect(path) as db:
        db.execute(
            "INSERT INTO scenario_context VALUES (1, ?)",
            (
                json.dumps(
                    {"snapshot_time": clock.isoformat(), "orders": [asdict(o) for o in orders]},
                    default=lambda d: d.isoformat(),
                ),
            ),
        )
        db.execute("INSERT INTO empty_event VALUES (1,1)")
        db.execute("INSERT INTO event_deletion_state VALUES (1)")
        db.execute("INSERT INTO sqlite_sequence(name,seq) VALUES ('event_history',1)")
    return store


def test_v0_restart_and_insertion(tmp_path):
    path = tmp_path / "v0.sqlite3"
    seed_v0(path)
    settings = Settings(path, Path("missing"))
    for _ in range(2):
        service = build_workbench(settings)
        state = service.workbench()
        plan, orders, clock, production = v0_data()
        assert state.baseline == plan
        assert service.orders == orders
        assert service.snapshot_time == clock
        assert state.event_cancelled
        assert not service.repository.event_history()
        assert not service.repository.history()
        resources = insertion_resources(plan, "test", demo_routes()["P-DEMO-001"], production)
        assert not validate_insertion(plan, plan, demo_machines(), resources, clock)
        assert all(
            max(o.end for o in plan.operations if o.order_id == order.id) <= order.due
            for order in orders
        )
        result = trial_insertion(
            plan,
            demo_machines(),
            orders,
            "test",
            clock.replace(hour=18),
            clock,
            clock,
            83,
            demo_routes()["P-DEMO-001"],
            resources,
        )
        assert result["summary"]["meets_due"]
        assert not result["baseline_resource_issues"]
        assert service.repository.current() == plan


def test_legacy_context_fallback(tmp_path):
    settings = Settings(tmp_path / "legacy.sqlite3", Path("missing"))
    service = build_workbench(settings)
    assert service.snapshot_time == EVENT_TIME
    assert service.orders == demo_orders()
    assert service.repository.current() == demo_schedule()


def test_invalid_persisted_context_is_rejected(tmp_path):
    path = tmp_path / "bad.sqlite3"
    seed_v0(path)
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE scenario_context SET payload=?",
            (json.dumps({"snapshot_time": "2026-10-26T10:00:00", "orders": []}),),
        )
    with pytest.raises(ValidationError):
        build_workbench(Settings(path, Path("missing")))
