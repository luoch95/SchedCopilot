"""FastAPI app factory. Run uvicorn sched_copilot.api:create_app --factory."""

from dataclasses import replace
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from ..bootstrap import build_workbench
from ..config import Settings
from ..observability import configure_logging
from .errors import register_errors
from .routes import router


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
    app = FastAPI(title="Schedule Copilot API", version="0.2.0")
    app.state.workbench = build_workbench(settings)
    register_errors(app)
    app.include_router(router)
    if (settings.frontend_dir / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=settings.frontend_dir / "assets"), name="assets")

        @app.get("/", include_in_schema=False)
        def index():
            return FileResponse(settings.frontend_dir / "index.html")

    return app
