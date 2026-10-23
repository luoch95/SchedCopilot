"""候选方案及其证据的结构，不代表正式生产计划。"""

from typing import Annotated, Literal

from pydantic import AwareDatetime, Field

from .common import Contract, Refs, Text
from .inputs import OperationSnapshot


class CandidateSnapshot(Contract):
    candidate_id: Text
    strategy_id: Text
    label: Text
    source_plan_ref: Text
    operations: list[OperationSnapshot]


class OperationChange(Contract):
    operation_id: Text
    order_id: Text
    before_machine_id: Text
    after_machine_id: Text
    before_start: AwareDatetime
    after_start: AwareDatetime
    before_end: AwareDatetime
    after_end: AwareDatetime
    impact_type: Text
    reason: Text
    impact_path: Text
    evidence_refs: Refs


class CandidateChanges(Contract):
    candidate_id: Text
    items: list[OperationChange]


class CandidateConstraintCheck(Contract):
    queue_policy: Literal["preserve", "append_tail"] = "preserve"
    candidate_id: Text
    passed: bool
    checked_items: list[Text]
    unchecked_items: list[Text]


Nonnegative = Annotated[float, Field(ge=0)]


class MachineLoad(Contract):
    changeovers: Annotated[int, Field(ge=0)] | None = None
    machine_id: Text
    baseline_processing_minutes: Nonnegative
    processing_minutes: Nonnegative
    delta_minutes: float
    available_minutes: Nonnegative | None = None
    setup_minutes: Nonnegative | None = None
    # Load relative to registered capacity may exceed 100% for reviewed overtime drafts.
    utilization: Nonnegative | None = None


class EvaluationMetrics(Contract):
    scope: Text
    time_unit: Text
    late_orders: Annotated[int, Field(ge=0)]
    baseline_late_orders: Annotated[int, Field(ge=0)]
    total_lateness_minutes: Nonnegative
    baseline_total_lateness_minutes: Nonnegative
    moved_operations: Annotated[int, Field(ge=0)]
    transferred_operations: Annotated[int, Field(ge=0)]
    delayed_operations: Annotated[int, Field(ge=0)]
    total_operation_delay_minutes: Nonnegative
    baseline_completion: AwareDatetime
    completion: AwareDatetime
    completion_delta_minutes: float
    machine_loads: list[MachineLoad]
    extra_changeovers: Annotated[int, Field(ge=0)] | None
    extra_changeover_minutes: Nonnegative | None
    baseline_changeovers: Annotated[int, Field(ge=0)] | None = None
    changeovers: Annotated[int, Field(ge=0)] | None = None
    baseline_changeover_minutes: Nonnegative | None = None
    changeover_minutes: Nonnegative | None = None
    orders_without_operations: list[Text]


class OperationDifference(Contract):
    operation_id: Text
    order_id: Text
    before_machine_id: Text
    after_machine_id: Text
    before_start: AwareDatetime
    after_start: AwareDatetime
    before_end: AwareDatetime
    after_end: AwareDatetime
    start_delay_minutes: float
    end_delay_minutes: float


class OrderDifference(Contract):
    order_id: Text
    priority: Annotated[int, Field(ge=0)]
    due_at: AwareDatetime
    before_completion: AwareDatetime
    after_completion: AwareDatetime
    completion_delay_minutes: float
    baseline_lateness_minutes: Nonnegative
    lateness_minutes: Nonnegative
    lateness_delta_minutes: float


class EvaluationDifferences(Contract):
    operations: list[OperationDifference]
    orders: list[OrderDifference]
