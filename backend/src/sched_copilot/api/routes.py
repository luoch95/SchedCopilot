"""HTTP adapters only: validate, invoke a use case, present its result."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request

from ..application.contracts import Analyze, Decide, SaveEvent
from ..application.workbench import WorkbenchService
from .presenters import simulation_view, workbench_view
from .schemas import (
    AnalysisRequest,
    DecisionRequest,
    EventRequest,
    SnapshotRequest,
    WorkflowRequest,
)
from .workflow_stream import workflow_stream

router = APIRouter(prefix="/api")


def workbench_service(request: Request) -> WorkbenchService:
    return request.app.state.workbench


Service = Annotated[WorkbenchService, Depends(workbench_service)]


@router.get("/health")
def health(request: Request):
    settings = request.app.state.settings
    return {
        "status": "ok",
        "live_analysis_configured": settings.llm_configured,
        "workflow_model_mode": settings.workflow_model_mode,
    }


@router.get("/workbench")
def workbench(service: Service):
    return workbench_view(service.workbench())


@router.put("/event")
def save_event(request: EventRequest, service: Service):
    return workbench_view(
        service.save_event(
            SaveEvent(
                request.version(),
                request.machine_id,
                request.started_at,
                request.recovered_at,
                request.source,
            )
        )
    )


@router.post("/event/recover")
def recover_event(request: SnapshotRequest, service: Service):
    return workbench_view(service.recover_event(request.version()))


@router.post("/simulations")
def simulate(request: SnapshotRequest, service: Service):
    return simulation_view(service.simulate(request.version()))


@router.post("/decisions")
def decide(request: DecisionRequest, service: Service):
    version, snapshot = service.decide(Decide(**request.model_dump()))
    return {"plan_version": version, "workbench": workbench_view(snapshot)}


@router.post("/analysis")
def analyze(request: AnalysisRequest, service: Service):
    return service.analyze(Analyze(request.version(), request.live, request.question))


@router.post("/workflow")
def workflow(request: WorkflowRequest, service: Service, http_request: Request):
    if "application/x-ndjson" in http_request.headers.get("accept", ""):

        def execute(emit):
            result, simulation = service.run_workflow(
                request.version(),
                intent=request.intent,
                question=request.question,
                workflow_id=request.workflow_id,
                on_progress=emit,
                demo_fallback=request.demo_fallback,
            )
            return {
                "workflow": result,
                "simulation": simulation_view(simulation) if simulation else None,
            }

        return workflow_stream(execute)
    result, simulation = service.run_workflow(
        request.version(),
        intent=request.intent,
        question=request.question,
        workflow_id=request.workflow_id,
        demo_fallback=request.demo_fallback,
    )
    return {"workflow": result, "simulation": simulation_view(simulation) if simulation else None}


@router.get("/workflow/demo")
def fallback_demo_status(service: Service):
    return service.workflow_runner.demo_gate.status()
