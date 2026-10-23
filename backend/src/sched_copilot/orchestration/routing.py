"""Pure deterministic routing for the four-Agent workflow."""

from enum import StrEnum

from ..agents.contracts.assessment import is_business_conclusion
from .state import WorkflowState


class Intent(StrEnum):
    GENERATE_CANDIDATES = "generate_candidates"
    RE_EVALUATE = "re_evaluate"
    EXPLAIN = "explain"
    VALIDATE = "validate"


class Action(StrEnum):
    VALIDATE = "validate"
    SCHEDULE = "schedule"
    EVALUATE = "evaluate"
    EXPLAIN = "explain"
    END = "end"


def route(state: WorkflowState) -> Action:
    """Every recorded result terminates its node, including blocked and failed results."""
    intent = Intent(state.intent)
    if intent is Intent.VALIDATE:
        return Action.END if state.validation_result is not None else Action.VALIDATE
    if intent is Intent.EXPLAIN:
        return Action.END if state.explanation_result is not None else Action.EXPLAIN
    if intent is Intent.RE_EVALUATE:
        return Action.END if state.evaluation_result is not None else Action.EVALUATE
    for action, result in (
        (Action.VALIDATE, state.validation_result),
        (Action.SCHEDULE, state.scheduling_result),
        (Action.EVALUATE, state.evaluation_result),
    ):
        if result is None:
            return action
        if result.status in {"blocked", "failed"}:
            if action is Action.SCHEDULE and is_business_conclusion(result):
                continue
            if action is Action.VALIDATE and state.explanation_input:
                return Action.END if state.explanation_result is not None else Action.EXPLAIN
            return Action.END
    if state.explanation_input and state.explanation_result is None:
        return Action.EXPLAIN
    return Action.END
