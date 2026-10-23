"""Seed optional inputs, or explicitly load a backed-up fault-comparison Mock."""

from pathlib import Path

from .config import Settings
from .infrastructure.sqlite_repository import DecisionStore, backup_database
from .scenarios.demo import demo_schedule
from .scenarios.production_demo import demo_production_inputs


def seed(path):
    path = Path(path)
    backup = backup_database(path) if path.exists() else None
    store = DecisionStore(path, demo_schedule())
    inserted = store.seed_production_inputs(demo_production_inputs())
    return {"database": str(path), "inserted": inserted, "backup": str(backup) if backup else None}


def seed_fault_comparison(path):
    """Explicit opt-in Mock upgrade; preserve requests/history and back up before writing."""
    import json
    from datetime import datetime, timezone

    from .domain.models import MachineFailure
    from .infrastructure.serialization import parse_schedule, schedule_json
    from .orchestration.engine import WorkflowEngine
    from .scenarios.demo import EVENT_TIME, demo_machines, demo_orders
    from .scenarios.production_demo import fault_tradeoff_inputs, fault_tradeoff_schedule

    path = Path(path)
    store = DecisionStore(path, demo_schedule())
    baseline = store.current()
    existing = store.production_snapshot()
    if existing and not existing.get("dataset_id", "").startswith("injection-demo-"):
        raise ValueError("只允许升级演示主数据")
    if existing and existing["dataset_id"] == "injection-demo-fault-tradeoff-v1":
        return {"inserted": False, "database": str(path), "version": baseline.version}
    plan = fault_tradeoff_schedule(baseline)
    inputs = fault_tradeoff_inputs(existing)
    event = MachineFailure(
        "M3", EVENT_TIME, EVENT_TIME.replace(hour=17), "四小时故障演示", EVENT_TIME
    )
    # Prove feasibility before changing persisted data; never invent a second candidate.
    checked = WorkflowEngine(production_provider=lambda: inputs)(
        plan,
        event,
        demo_machines(),
        demo_orders() + store.published_orders(),
        EVENT_TIME,
        1,
        intent="generate_candidates",
        question="比较故障方案",
    )
    if checked.payload["status"] != "completed" or len(checked.candidates) != 2:
        raise ValueError("当前计划无法载入双方案演示；未修改数据库")
    backup = backup_database(path)
    now = datetime.now(timezone.utc).isoformat()
    with store._connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        current = conn.execute("SELECT payload FROM current_plan WHERE id=1").fetchone()[0]
        production_row = conn.execute("SELECT payload FROM production_inputs WHERE id=1").fetchone()
        current_inputs = json.loads(production_row[0]) if production_row else None
        if current_inputs != existing:
            raise ValueError("生产主数据已变化，请重新载入")
        if parse_schedule(current).fingerprint != baseline.fingerprint:
            raise ValueError("计划已变化，请重新载入")
        conn.execute("UPDATE current_plan SET payload=? WHERE id=1", (schedule_json(plan),))
        conn.execute(
            "INSERT OR REPLACE INTO production_inputs VALUES (1, ?)",
            (json.dumps(inputs, ensure_ascii=False),),
        )
        conn.execute(
            "INSERT INTO decisions VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)",
            (
                f"demo-fault-tradeoff-v1-{baseline.fingerprint}",
                "publish",
                plan.fingerprint,
                "载入M3故障双方案Mock：增加M2负荷及模具资格约束",
                now,
                schedule_json(plan),
                json.dumps(
                    {
                        "published_by": "demo_setup",
                        "version_summary": "演示数据调整：M3四小时故障取舍案例，保留已有插单及历史",
                        "previous_plan": json.loads(current),
                    },
                    ensure_ascii=False,
                ),
            ),
        )
    return {"database": str(path), "inserted": True, "version": plan.version, "backup": str(backup)}


if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--fault-comparison", action="store_true", help="载入有延期取舍的M3故障Mock"
    )
    args = parser.parse_args()
    action = seed_fault_comparison if args.fault_comparison else seed
    print(json.dumps(action(Settings.from_env().database_path), ensure_ascii=False))
