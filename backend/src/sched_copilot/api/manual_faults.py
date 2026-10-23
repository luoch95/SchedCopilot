"""HTTP commands for the independent manual-draft lifecycle."""

from fastapi import APIRouter, Request
from fastapi.encoders import jsonable_encoder

from .manual_contracts import (
    ConfirmManualDraft,
    CreateManualDraft,
    ManualDraftResponse,
    SaveManualDraft,
)
from .presenters import simulation_view

router = APIRouter(prefix="/api/fault-drafts")


def present(result):
    if isinstance(result, tuple):
        draft, simulation = result
        result = {**draft, "simulation": simulation_view(simulation)}
    if result:
        result = {
            k: v for k, v in result.items() if k not in {"source_input", "production_snapshot"}
        }
    return jsonable_encoder(result)


@router.get("/latest", response_model=ManualDraftResponse | None)
def latest(request: Request):
    service = request.app.state.manual_faults
    return present(service.response(service.get()))


@router.get("/{draft_id}", response_model=ManualDraftResponse)
def read(draft_id: str, request: Request):
    service = request.app.state.manual_faults
    return present(service.response(service.get(draft_id)))


@router.post("", response_model=ManualDraftResponse)
def create(command: CreateManualDraft, request: Request):
    return present(request.app.state.manual_faults.create(command))


@router.put("/{draft_id}", response_model=ManualDraftResponse)
def save(draft_id: str, command: SaveManualDraft, request: Request):
    return present(request.app.state.manual_faults.save(draft_id, command))


@router.post("/{draft_id}/confirm", response_model=ManualDraftResponse)
def confirm(draft_id: str, command: ConfirmManualDraft, request: Request):
    service = request.app.state.manual_faults
    result = service.confirm(draft_id, command)
    return present(result if isinstance(result, tuple) else service.response(result))
