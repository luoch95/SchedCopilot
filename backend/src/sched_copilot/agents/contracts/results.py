"""Role-specific JSON output schemas; no business execution lives here."""

from typing import Literal

from .common import Contract, Refs, ResultBase, Statement, Text


class ValidationIssue(Contract):
    code: Text
    severity: Literal["blocking", "warning", "info"]
    message: Text
    impact: Text
    repair_hint: Text
    evidence_refs: Refs


class ValidationData(Contract):
    can_generate_candidates: bool
    checked_items: list[Text]
    unchecked_items: list[Text]
    issues: list[ValidationIssue]


class CandidateReference(Contract):
    candidate_id: Text
    strategy_id: Text
    plan_ref: Text
    changes_ref: Text
    constraint_check_ref: Text
    evidence_refs: Refs


class SchedulingData(Contract):
    candidate_batch_id: Text
    candidates: list[CandidateReference]
    assumptions: list[Statement]
    limitations: list[Text]


class CandidateEvaluation(Contract):
    candidate_id: Text
    metrics_ref: Text
    differences_ref: Text
    risks: list[Statement]
    missing_metrics: list[Text]
    evidence_refs: Refs


class EvaluationTradeoff(Contract):
    candidate_ids: list[Text]
    description: Text
    evidence_refs: Refs


class AnalysisAssessment(Contract):
    outcome: Literal["no_feasible_candidate"]
    summary: Text
    findings: list[Statement]
    recommendations: list[Text]
    limitations: list[Text]


class EvaluationData(Contract):
    candidate_batch_id: Text
    criteria_ref: Text | None
    evaluations: list[CandidateEvaluation]
    tradeoffs: list[EvaluationTradeoff]
    assessment: AnalysisAssessment | None = None


class ExplanationTradeoff(Contract):
    text: Text
    candidate_ids: list[Text]
    evidence_refs: Refs


class NextStep(Contract):
    action: Text
    requires_human_confirmation: bool
    evidence_refs: Refs


class ExplanationData(Contract):
    summary: Text
    facts: list[Statement]
    assumptions: list[Statement]
    risks: list[Statement]
    tradeoffs: list[ExplanationTradeoff]
    next_steps: list[NextStep]
    limitations: list[Text]


class ValidationResult(ResultBase):
    agent_name: Literal["validation"]
    data: ValidationData | None


class SchedulingResult(ResultBase):
    agent_name: Literal["scheduling"]
    data: SchedulingData | None


class EvaluationResult(ResultBase):
    agent_name: Literal["evaluation"]
    data: EvaluationData | None


class ExplanationResult(ResultBase):
    agent_name: Literal["explanation"]
    data: ExplanationData | None


AgentResult = ValidationResult | SchedulingResult | EvaluationResult | ExplanationResult
