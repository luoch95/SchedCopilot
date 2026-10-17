"""候选方案及其证据的结构，不代表正式生产计划。"""

from pydantic import AwareDatetime

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
    candidate_id: Text
    passed: bool
    checked_items: list[Text]
    unchecked_items: list[Text]
