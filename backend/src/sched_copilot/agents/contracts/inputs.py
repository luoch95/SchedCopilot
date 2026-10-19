"""Typed inputs and scheduling-case snapshot DTOs, separate from domain entities."""

from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, JsonValue

from .common import AgentInput, Contract, Text
from .results import EvaluationData, SchedulingData, ValidationData


class MachineSnapshot(Contract):
    machine_id: Text
    capabilities: list[Text]
    available: bool


class MoldSnapshot(Contract):
    mold_id: Text
    compatible_machine_ids: list[Text]


class OrderSnapshot(Contract):
    order_id: Text
    due_at: AwareDatetime
    priority: Annotated[int, Field(ge=0)]


class OperationSnapshot(Contract):
    operation_id: Text
    order_id: Text
    sequence: Annotated[int, Field(ge=1)]
    machine_id: Text
    mold_id: Text | None
    capability: Text
    start_at: AwareDatetime
    duration_minutes: Annotated[int, Field(gt=0)]
    status: Literal["planned", "in_progress", "completed"]


class FailureSnapshot(Contract):
    event_id: Text
    machine_id: Text
    started_at: AwareDatetime
    estimated_recovery_at: AwareDatetime | None
    received_at: AwareDatetime
    source: Text


class ShiftSnapshot(Contract):
    machine_id: Text
    start_at: AwareDatetime
    end_at: AwareDatetime


class ProductionSnapshot(Contract):
    source: Text
    shifts: list[ShiftSnapshot]
    initial_molds: dict[Text, Text]
    changeover_minutes: Annotated[int, Field(gt=0)]


class SchedulingCase(Contract):
    """A DTO, not a business validator; conflicts are reported by the validation tool."""

    report_snapshot_at: AwareDatetime
    orders: list[OrderSnapshot]
    operations: list[OperationSnapshot]
    machines: list[MachineSnapshot]
    molds: list[MoldSnapshot]
    failures: list[FailureSnapshot]
    wip_policy: Text | None
    production: ProductionSnapshot | None = None


class ValidationInput(AgentInput):
    agent_name: Literal["validation"]
    intent: Text
    case_data: SchedulingCase
    validation_tool_result: ValidationData | None


class Strategy(Contract):
    strategy_id: Text
    description: Text
    parameters: dict[Text, JsonValue]


class SchedulingInput(AgentInput):
    agent_name: Literal["scheduling"]
    validation_result_ref: Text
    current_plan_ref: Text
    user_constraints: list[Text]
    allowed_strategies: list[Strategy]
    wip_policy: Text | None
    scheduling_tool_result: SchedulingData | None


class EvaluationInput(AgentInput):
    agent_name: Literal["evaluation"]
    current_plan_ref: Text
    candidate_batch_id: Text
    candidate_refs: dict[Text, Text]
    evaluation_criteria_ref: Text | None
    evaluation_tool_result: EvaluationData | None


class ExplanationInput(AgentInput):
    agent_name: Literal["explanation"]
    question: Text
    validation_result_ref: Text | None
    candidate_batch_ref: Text | None
    evaluation_result_ref: Text | None
    assumptions: list[Text]


AgentRequest = ValidationInput | SchedulingInput | EvaluationInput | ExplanationInput
