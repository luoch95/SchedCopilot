"""HTTP adapters only: validate, invoke a use case, present its result."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request, Response

from ..application.contracts import Analyze, Decide, SaveEvent
from ..application.workbench import WorkbenchService
from .demo_access import COOKIE, SESSION_SECONDS, LoginRequest, is_admin, new_session
from .presenters import simulation_view, workbench_view
from .schemas import (
    AnalysisRequest,
    AssessmentReviewSubmit,
    DecisionRequest,
    EventRequest,
    FaultReviewAction,
    FaultReviewSubmit,
    InsertionAction,
    ProcessingEstimateRequest,
    SalesRequestCreate,
    SalesRequestView,
    SnapshotRequest,
    WorkflowRequest,
)
from .workflow_stream import workflow_stream

router = APIRouter(prefix="/api")


@router.get("/demo/session")
def demo_session(request: Request):
    return {
        "admin": is_admin(request),
        "read_only": request.app.state.settings.demo_mode and not is_admin(request),
    }


@router.post("/demo/login")
def demo_login(payload: LoginRequest, request: Request, response: Response):
    token = new_session(request, payload.password)
    response.set_cookie(
        COOKIE,
        token,
        httponly=True,
        samesite="strict",
        secure=request.url.scheme == "https",
        max_age=SESSION_SECONDS,
        path="/api",
    )
    return {"admin": True, "read_only": False}


@router.post("/demo/logout")
def demo_logout(request: Request, response: Response):
    request.app.state.demo_sessions.pop(request.cookies.get(COOKIE, ""), None)
    response.delete_cookie(COOKIE, path="/api")
    return {"admin": False, "read_only": request.app.state.settings.demo_mode}


@router.post("/demo/reset")
def demo_reset(request: Request):
    from ..demo_preview import reset_demo

    reset_demo(request.app.state.settings)
    return {"reset": True}


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


@router.get("/workflow/latest")
def latest_workflow(service: Service):
    saved = service.latest_workflow()
    if saved is None:
        return None
    result, simulation = saved
    return {"workflow": result, "simulation": simulation_view(simulation) if simulation else None}


@router.get("/events/{revision}/analysis")
def historical_fault_analysis(revision: int, service: Service):
    return service.fault_analysis(revision)


@router.get("/workflow/demo")
def fallback_demo_status(service: Service):
    return service.workflow_runner.demo_gate.status()


@router.get("/sales/overview")
def sales_overview(service: Service, request: Request):
    return request.app.state.sales.overview(service.workbench())


@router.post("/sales/processing-estimate")
def sales_processing_estimate(payload: ProcessingEstimateRequest, request: Request):
    return request.app.state.sales.estimate(payload.product_id, payload.quantity)


@router.post("/sales/requests", response_model=SalesRequestView, status_code=201)
def submit_sales_request(payload: SalesRequestCreate, service: Service, request: Request):
    snapshot = service.workbench()
    return request.app.state.sales_requests.submit(
        **payload.model_dump(),
        plan_version=snapshot.baseline.version,
        plan_fingerprint=snapshot.baseline.fingerprint,
        snapshot_time=snapshot.snapshot_time,
    )


@router.get("/sales/requests", response_model=list[SalesRequestView])
def pending_sales_requests(
    request: Request,
    service: Service,
    status: Literal["all", "pending_approval", "approved", "rejected", "published"] = "all",
    assigned_planner: str | None = None,
):
    return request.app.state.sales_requests.pending(
        service.workbench(), service.repository.production_snapshot(), status, assigned_planner
    )


@router.get("/sales/requests/{request_no}", response_model=SalesRequestView)
def sales_request_detail(request_no: str, request: Request, service: Service):
    return request.app.state.sales_requests.detail(
        request_no, service.workbench(), service.repository.production_snapshot()
    )


@router.post("/sales/requests/{request_id}/assessment")
def assess_sales_request(request_id: str, request: Request, service: Service):
    return request.app.state.sales_requests.assess(
        request_id, service.workbench(), service.repository.production_snapshot()
    )


@router.post("/sales/requests/{request_id}/actions", response_model=SalesRequestView)
def act_on_sales_request(
    request_id: str, payload: InsertionAction, request: Request, service: Service
):
    return request.app.state.sales_requests.act(
        request_id,
        **payload.model_dump(),
        snapshot=service.workbench(),
        production_snapshot=service.repository.production_snapshot(),
    )


@router.post("/workflow/{workflow_id}/review")
def submit_assessment_review(workflow_id: str, request: AssessmentReviewSubmit, service: Service):
    return workbench_view(
        service.submit_assessment_review(workflow_id, request.reason, request.request_id)
    )


@router.post("/fault-reviews")
def submit_fault_review(request: FaultReviewSubmit, service: Service):
    return workbench_view(
        service.submit_fault_review(
            request.simulation_id, request.candidate_id, request.reason, request.request_id
        )
    )


@router.post("/fault-reviews/{review_id}/actions")
def review_fault(review_id: str, request: FaultReviewAction, service: Service):
    return workbench_view(service.review_fault(review_id, request.action, request.reason))
