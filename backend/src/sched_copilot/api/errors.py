"""One HTTP error contract; business code never imports HTTP status codes."""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from ..application.errors import (
    AnalysisUnavailable,
    ApplicationError,
    InvalidInput,
    ResourceNotFound,
    SnapshotConflict,
)
from ..domain.errors import RuleViolation

STATUS = {SnapshotConflict: 409, ResourceNotFound: 404, InvalidInput: 422, AnalysisUnavailable: 502}


def register_errors(app: FastAPI) -> None:
    @app.exception_handler(ApplicationError)
    async def application_error(request: Request, exc: ApplicationError):
        return JSONResponse(
            status_code=STATUS[type(exc)], content={"detail": str(exc), "code": exc.code}
        )

    @app.exception_handler(RuleViolation)
    async def rule_violation(request: Request, exc: RuleViolation):
        return JSONResponse(status_code=409, content={"detail": str(exc), "code": "rule_violation"})
