"""HTTP boundary. Scheduling and publication remain authoritative on the server."""

import os
from dataclasses import asdict
from datetime import timedelta
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, TypeAdapter

from .agents import run_analysis
from .domain import CandidatePlan, MachineFailure
from .impact import operation_changes, order_impacts
from .scenario import EVENT_TIME, demo_machines, demo_orders, demo_schedule
from .scheduling import affected_operations, failure_issues, generate_candidates
from .storage import DecisionStore

CANDIDATES = TypeAdapter(tuple[CandidatePlan, ...])
REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


class SnapshotRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_revision: int = Field(ge=1)
    baseline_fingerprint: str


class EventRequest(SnapshotRequest):
    machine_id: str
    started_at: AwareDatetime
    recovered_at: AwareDatetime | None
    source: str = Field(min_length=1, max_length=200)


class DecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    simulation_id: str
    candidate_id: str
    action: Literal["publish", "reject"]
    reason: str = Field(min_length=1, max_length=2000)
    request_id: str = Field(min_length=1, max_length=100)


class AnalysisRequest(SnapshotRequest):
    live: bool = False
    question: str = Field(default="设备故障后，应该如何比较方案？", min_length=1, max_length=2000)


def schedule_view(schedule):
    return {
        **asdict(schedule),
        "fingerprint": schedule.fingerprint,
        "operations": [{**asdict(op), "end": op.end} for op in schedule.operations],
    }


def create_app(db_path: str | Path | None = None, frontend_dir: Path | None = None):
    app = FastAPI(title="Schedule Copilot API", version="0.2.0")
    store = DecisionStore(
        db_path or os.getenv("SCHED_DB_PATH") or REPOSITORY_ROOT / ".data" / "decisions.sqlite3",
        demo_schedule(),
    )
    machines, orders = demo_machines(), demo_orders()
    example = MachineFailure(
        "M1", EVENT_TIME, EVENT_TIME + timedelta(hours=4), "计划员手动录入", EVENT_TIME
    )
    if store.active_event() is None:
        try:
            store.record_event(example, expected_revision=0)
        except ValueError:
            pass  # Another worker initialized the shared store.

    @app.exception_handler(ValueError)
    async def invalid_input(request, exc):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    def checked_snapshot(request):
        baseline, event, revision = store.snapshot()
        if (
            request.event_revision != revision
            or request.baseline_fingerprint != baseline.fingerprint
        ):
            raise HTTPException(409, "事件或计划已更新，请重新载入后操作")
        return baseline, event, revision

    def workbench():
        baseline, event, revision = store.snapshot()
        issues = failure_issues(baseline, event, machines)
        return jsonable_encoder(
            {
                "baseline": schedule_view(baseline),
                "event": asdict(event),
                "event_revision": revision,
                "snapshot_time": EVENT_TIME,
                "machines": machines,
                "orders": orders,
                "affected": [op.id for op in affected_operations(baseline, event)],
                "issues": issues,
                "history": store.history(),
            }
        )

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/workbench")
    def get_workbench():
        return workbench()

    @app.put("/api/event")
    def save_event(request: EventRequest):
        checked_snapshot(request)
        if request.machine_id not in {machine.id for machine in machines}:
            raise HTTPException(422, "故障设备不存在")
        event = MachineFailure(
            request.machine_id,
            request.started_at,
            request.recovered_at,
            request.source.strip(),
            max(EVENT_TIME, request.started_at),
        )
        store.record_event(event, expected_revision=request.event_revision)
        return workbench()

    @app.post("/api/event/recover")
    def recover_event(request: SnapshotRequest):
        checked_snapshot(request)
        store.recover_event(machines, orders, example, expected_revision=request.event_revision)
        return workbench()

    @app.post("/api/simulations")
    def simulate(request: SnapshotRequest):
        baseline, event, revision = checked_snapshot(request)
        candidates = generate_candidates(baseline, event, machines, orders, event_revision=revision)
        simulation_id = str(uuid4())
        store.record_simulation(simulation_id, CANDIDATES.dump_json(candidates).decode(), event)
        return jsonable_encoder(
            {
                "id": simulation_id,
                "event_revision": revision,
                "baseline_fingerprint": baseline.fingerprint,
                "candidates": [
                    {
                        **asdict(item),
                        "schedule": schedule_view(item.schedule),
                        "changes": operation_changes(baseline, item, event),
                        "order_impacts": order_impacts(baseline, item, orders),
                    }
                    for item in candidates
                ],
            }
        )

    @app.post("/api/decisions")
    def decide(request: DecisionRequest):
        row = store.simulation(request.simulation_id)
        if not row:
            raise HTTPException(404, "候选批次不存在，请重新生成方案")
        candidates = CANDIDATES.validate_json(row[0])
        candidate = next((item for item in candidates if item.id == request.candidate_id), None)
        if candidate is None:
            raise HTTPException(404, "该批次没有此候选方案")
        if request.action == "publish" and candidate.metrics.moved_operations == 0:
            raise HTTPException(409, "该候选与当前计划相同，无需重复发布")
        result = store.decide(
            candidate,
            row[1],
            machines,
            request.action,
            request.reason,
            request.request_id,
        )
        return {"plan_version": result.version, "workbench": workbench()}

    @app.post("/api/analysis")
    def analyze(request: AnalysisRequest):
        baseline, event, _ = checked_snapshot(request)
        try:
            reports = run_analysis(
                baseline, event, machines, orders, live=request.live, question=request.question
            )
        except Exception as exc:
            raise HTTPException(502, "分析未完成，请检查模型配置和连接；排程仍可使用") from exc
        checked_snapshot(request)
        return {"reports": reports, "mode": "live" if request.live else "offline"}

    # Production can serve the separately built frontend from the same origin.
    build = Path(
        frontend_dir or os.getenv("SCHED_FRONTEND_DIR") or REPOSITORY_ROOT / "frontend" / "dist"
    )
    if (build / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=build / "assets"), name="assets")

        @app.get("/", include_in_schema=False)
        def index():
            return FileResponse(build / "index.html")

    return app
