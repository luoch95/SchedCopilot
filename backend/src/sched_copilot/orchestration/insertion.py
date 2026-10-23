"""Four authoritative insertion tools with optional bounded model assistance."""

from time import monotonic
from uuid import uuid4

from ..agents.evaluation_agent import EvaluationAgent
from ..agents.explanation_agent import ExplanationAgent
from ..agents.scheduling_agent import SchedulingAgent
from ..agents.validation_agent import ValidationAgent


class InsertionWorkflow:
    def __init__(self, model_assistant=None, knowledge_tool=None):
        self.model_assistant = model_assistant
        self.validation = ValidationAgent()
        self.scheduling = SchedulingAgent()
        self.evaluation = EvaluationAgent()
        self.explanation = ExplanationAgent(knowledge_tool=knowledge_tool)

    def __call__(self, request, snapshot, calculate):
        trace_id = f"TRC-{uuid4().hex.upper()}"
        trace = []
        started = monotonic()
        model_error = None

        def record(role, result=None):
            nonlocal model_error, started
            step = dict(agent=role, status="success", mode="rules")
            if self.model_assistant:
                execution = self.model_assistant.run(role, request, result, skip_code=model_error)
                step.update(mode=execution["mode"], execution=execution)
                # Stop further provider calls after a failure within this assessment.
                model_error = execution["error_code"]
            step.update(
                span_id=f"SPN-{uuid4().hex}", elapsed_ms=round((monotonic() - started) * 1000)
            )
            trace.append(step)
            started = monotonic()

        validated = self.validation.run_insertion(request, snapshot)
        record("validation")
        result = self.scheduling.run_insertion(calculate, snapshot)
        record("scheduling", result)
        evaluated = self.evaluation.run_insertion(result, snapshot, request)
        record("evaluation", result)
        explanation = self.explanation.run_insertion(result, request, skip_model_code=model_error)
        record("explanation", result)
        result["workflow"] = dict(
            trace_id=trace_id,
            mode=("fallback" if model_error else "live") if self.model_assistant else "rules",
            trace=trace,
            validation=validated,
            evaluation=evaluated,
            explanation=explanation,
        )
        return result
