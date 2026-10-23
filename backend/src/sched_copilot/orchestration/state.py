"""Typed shared state used by the dynamic workflow."""

from typing import Literal

from ..agents.contracts.common import AgentContext, Contract, Evidence, Text
from ..agents.contracts.inputs import (
    EvaluationInput,
    ExplanationInput,
    SchedulingInput,
    ValidationInput,
)
from ..agents.contracts.results import (
    EvaluationResult,
    ExplanationResult,
    SchedulingResult,
    ValidationResult,
)

WorkflowStatus = Literal["ready", "running", "completed", "blocked", "failed"]


class WorkflowState(Contract):
    """Only structured results and references cross Agent boundaries."""

    context: AgentContext
    intent: Text
    evidence_catalog: dict[Text, Evidence]
    validation_result_ref: Text | None = None
    candidate_batch_ref: Text | None = None
    evaluation_result_ref: Text | None = None
    explanation_result_ref: Text | None = None
    validation_input: ValidationInput | None = None
    scheduling_input: SchedulingInput | None = None
    evaluation_input: EvaluationInput | None = None
    explanation_input: ExplanationInput | None = None
    validation_result: ValidationResult | None = None
    scheduling_result: SchedulingResult | None = None
    evaluation_result: EvaluationResult | None = None
    explanation_result: ExplanationResult | None = None
    workflow_status: WorkflowStatus = "ready"
    failure_code: str | None = None
