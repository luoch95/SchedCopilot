"""Four authoritative insertion tools with optional bounded model assistance."""

from ..agents.evaluation_agent import EvaluationAgent
from ..agents.explanation_agent import ExplanationAgent
from ..agents.scheduling_agent import SchedulingAgent
from ..agents.validation_agent import ValidationAgent


class InsertionWorkflow:
    def __init__(self, model_assistant=None):
        self.model_assistant = model_assistant
        self.validation = ValidationAgent()
        self.scheduling = SchedulingAgent()
        self.evaluation = EvaluationAgent()
        self.explanation = ExplanationAgent()

    def __call__(self, request, snapshot, calculate):
        trace = []
        model_error = None

        def record(role, result=None):
            nonlocal model_error
            step = dict(agent=role, status="success", mode="rules")
            if self.model_assistant:
                execution = self.model_assistant.run(role, request, result, skip_code=model_error)
                step.update(mode=execution["mode"], execution=execution)
                # Stop further provider calls after a failure within this assessment.
                model_error = execution["error_code"]
            trace.append(step)

        validated = self.validation.run_insertion(request, snapshot)
        record("validation")
        result = self.scheduling.run_insertion(calculate, snapshot)
        record("scheduling", result)
        evaluated = self.evaluation.run_insertion(result, snapshot, request)
        record("evaluation", result)
        explanation = self.explanation.run_insertion(result)
        record("explanation", result)
        result["workflow"] = dict(
            mode=("fallback" if model_error else "live") if self.model_assistant else "rules",
            trace=trace,
            validation=validated,
            evaluation=evaluated,
            explanation=explanation,
        )
        return result
