"""FastAPI app factory. Run uvicorn sched_copilot.api:create_app --factory."""

from dataclasses import replace
from functools import partial
from pathlib import Path
from threading import Lock

from fastapi import Depends, FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from ..bootstrap import build_sales, build_workbench
from ..config import Settings
from ..infrastructure.metrics import metric_records
from ..infrastructure.visits import VisitStore
from ..observability import configure_logging
from ..telemetry_wiring import build_telemetry
from .demo_access import require_write_access
from .errors import register_errors
from .manual_faults import router as manual_router
from .routes import router
from .visits import install_visits


def create_app(
    db_path: str | Path | None = None,
    frontend_dir: Path | None = None,
    settings: Settings | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    if db_path is not None:
        settings = replace(settings, database_path=Path(db_path))
    if frontend_dir is not None:
        settings = replace(settings, frontend_dir=frontend_dir)
    configure_logging(settings.log_level)
    app = FastAPI(
        title="Schedule Copilot API", version="0.2.0", dependencies=[Depends(require_write_access)]
    )
    app.state.settings = settings
    app.state.metric_records = partial(metric_records, settings.database_path)
    app.state.demo_sessions = {}
    app.state.demo_write_lock = Lock()
    if settings.demo_mode:
        from ..demo_preview import reset_demo

        reset_demo(settings)
    # Normalize persisted business numbers before restoring formal-plan display metadata.
    app.state.sales, app.state.sales_requests = build_sales(settings)
    app.state.workbench = build_workbench(settings)
    app.state.telemetry = build_telemetry(settings)
    app.state.workbench.telemetry = app.state.telemetry
    app.state.sales_requests.telemetry = app.state.telemetry
    app.state.manual_faults = app.state.workbench.manual_faults
    install_visits(app, VisitStore(settings.database_path).record)
    register_errors(app)
    app.include_router(router)
    app.include_router(manual_router)
    if (settings.frontend_dir / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=settings.frontend_dir / "assets"), name="assets")

        @app.get("/", include_in_schema=False)
        @app.get("/admin", include_in_schema=False)
        def index():
            return FileResponse(settings.frontend_dir / "index.html")

    return app
