"""Strict commands for fault-plan drafts. Roles are demo identities, not authentication."""

from datetime import datetime
from typing import Literal

from pydantic import AwareDatetime, Field, JsonValue, field_validator

from ..agents.contracts.common import Contract


class CreateManualDraft(Contract):
    workflow_id: str = Field(min_length=1, max_length=100)
    simulation_id: str | None = None
    candidate_id: str | None = None
    operator_role: Literal["planner"] = "planner"


class ManualMove(Contract):
    operation_id: str = Field(min_length=1, max_length=100)
    machine_id: str = Field(min_length=1, max_length=100)
    start: AwareDatetime

    @field_validator("start", mode="before")
    @classmethod
    def iso_start(cls, value):
        return datetime.fromisoformat(value) if isinstance(value, str) else value


class SaveManualDraft(Contract):
    revision: int = Field(ge=1)
    moves: list[ManualMove] = Field(max_length=1000)
    reason: str = Field(default="", max_length=2000)
    operator_role: Literal["planner"] = "planner"


class ConfirmManualDraft(Contract):
    revision: int = Field(ge=1)
    operator_role: Literal["planner"] = "planner"


class ManualEdit(Contract):
    operation_id: str
    order_id: str
    before: dict[str, str]
    after: dict[str, str]
    operator: str
    at: str
    reason: str


class ManualReport(Contract):
    title: str
    draft_id: str
    revision: int = Field(ge=1)
    rules_work: str
    model_work: str
    model: dict[str, JsonValue]
    manual_summary: str
    edits: list[ManualEdit]
    source_candidate_id: str | None
    comparison: str
    source_changes: list[dict[str, JsonValue]]
    changes: list[dict[str, JsonValue]]
    order_impacts: list[dict[str, JsonValue]]
    risks: list[str]
    decision: str
    created_at: str


class ManualDraftResponse(Contract):
    id: str
    revision: int = Field(ge=1)
    status: Literal["editing", "ready_for_review"]
    workflow_id: str
    source_candidate_id: str | None
    source_simulation_id: str | None
    event_revision: int
    baseline_fingerprint: str
    input_fingerprint: str
    baseline: dict[str, JsonValue]
    origin: dict[str, JsonValue]
    schedule: dict[str, JsonValue]
    event: dict[str, JsonValue]
    edits: list[ManualEdit]
    issues: list[str]
    report: ManualReport | None
    simulation_id: str | None
    simulation: dict[str, JsonValue] | None
    created_at: str
    updated_at: str
