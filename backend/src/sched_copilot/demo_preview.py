"""Build the fixed preview with real rules, never contacting a model provider."""

from dataclasses import replace
from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

from .application.contracts import SaveEvent, SnapshotVersion
from .bootstrap import build_sales, build_workbench
from .infrastructure.sqlite_repository import replace_database
from .scenarios.demo import EVENT_TIME
from .scenarios.production_demo import demo_production_inputs


def reset_demo(settings):
    """Prepare a complete database before atomically replacing its business contents."""
    path = Path(settings.database_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=path.parent, ignore_cleanup_errors=True) as directory:
        staged = Path(directory) / "preview.sqlite3"
        fixed = replace(settings, database_path=staged, workflow_model_mode="rules")
        _, requests = build_sales(fixed)
        workbench = build_workbench(fixed)
        workbench.repository.seed_production_inputs(demo_production_inputs())
        snapshot = workbench.workbench()
        workbench.save_event(
            SaveEvent(
                SnapshotVersion(snapshot.event_revision, snapshot.baseline.fingerprint),
                "M3",
                EVENT_TIME,
                EVENT_TIME + timedelta(hours=4),
                "固定演示故障 R2",
            )
        )
        snapshot = workbench.workbench()
        workflow, simulation = workbench.run_workflow(
            SnapshotVersion(snapshot.event_revision, snapshot.baseline.fingerprint),
            intent="generate_candidates",
            question="比较故障 R2 的原设备顺延与合格设备转移方案",
        )
        assert workflow["status"] == "completed" and simulation is not None
        assert [c.candidate.metrics.total_lateness_minutes for c in simulation.candidates] == [
            255,
            45,
        ]
        record = requests.submit(
            product_id="P-DEMO-001",
            quantity=100,
            earliest_start_at=EVENT_TIME,
            requested_due_at=EVENT_TIME + timedelta(days=2),
            reason="演示客户紧急补货，待领导审批后由排产员复核发布",
            submission_key="fixed-preview-insertion-v1",
            plan_version=snapshot.baseline.version,
            plan_fingerprint=snapshot.baseline.fingerprint,
            snapshot_time=EVENT_TIME,
        )
        requests.assess(record["id"], snapshot, workbench.repository.production_snapshot())
        requests.repository.engine.dispose()
        # SQLite backup commits the entire staged snapshot, so failed preparation leaves
        # the active demo intact. Existing service adapters keep the same database path.
        replace_database(staged, path)
