"""Insert optional demo inputs without modifying plans, events or decisions."""

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


if __name__ == "__main__":
    import json

    print(json.dumps(seed(Settings.from_env().database_path), ensure_ascii=False))
