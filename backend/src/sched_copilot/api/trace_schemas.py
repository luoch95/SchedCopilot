"""Strict, deliberately small diagnostic view contracts."""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class DiagnosticSpan(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    id: str
    name: str
    kind: Literal["chain", "tool", "llm"]
    parent_id: str | None
    started_at: str
    ended_at: str
    status: Literal["success", "warning", "blocked", "failed"]
    elapsed_ms: int
    mode: str | None = None
    model: str | None = None
    error_code: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    corrections: int | None = None
    failure_phase: str | None = None


class DiagnosticRun(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    id: str
    business_type: Literal["fault", "insertion"]
    business_id: str | None = None
    workflow_id: str | None = None
    assessment_id: str | None = None
    local_trace_id: str | None = None
    plan_version: int | None = None
    event_revision: int | None = None
    input_fingerprint: str | None = None
    started_at: str
    ended_at: str
    status: Literal["completed", "failed", "blocked"]
    elapsed_ms: int
    mode: Literal["rules", "live", "fallback"]
    model_calls: int
    input_tokens: int | None
    output_tokens: int | None
    error_code: str | None = None
    upload_status: Literal[
        "disabled", "not_configured", "queued", "uploaded", "failed", "queue_full"
    ]
    upload_error: str | None = None
    langsmith_url: str | None = None
    spans: list[DiagnosticSpan]


class DiagnosticPage(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    items: list[DiagnosticRun]
    total: int
    page: int
