"""Bounded insertion workflow using the existing four Agent classes in rules mode."""

from ..agents.evaluation_agent import EvaluationAgent
from ..agents.explanation_agent import ExplanationAgent
from ..agents.scheduling_agent import SchedulingAgent
from ..agents.validation_agent import ValidationAgent


class InsertionWorkflow:
    def __init__(self):
        self.validation = ValidationAgent()
        self.scheduling = SchedulingAgent()
        self.evaluation = EvaluationAgent()
        self.explanation = ExplanationAgent()

    def __call__(self, request, snapshot, calculate):
        trace = []
        validated = self.validation.run_insertion(request, snapshot)
        trace.append(dict(agent="validation", status="success", mode="rules"))
        result = self.scheduling.run_insertion(calculate, snapshot)
        trace.append(dict(agent="scheduling", status="success", mode="rules"))
        evaluated = self.evaluation.run_insertion(result, snapshot, request)
        trace.append(dict(agent="evaluation", status="success", mode="rules"))
        explanation = self.explanation.run_insertion(result)
        trace.append(dict(agent="explanation", status="success", mode="rules"))
        result["workflow"] = dict(
            mode="rules",
            trace=trace,
            validation=validated,
            evaluation=evaluated,
            explanation=explanation,
        )
        return result
