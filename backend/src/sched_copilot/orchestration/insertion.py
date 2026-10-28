"""Four authoritative insertion tools with optional bounded model assistance."""

from time import monotonic
from uuid import uuid4

from ..agents.evaluation_agent import EvaluationAgent
from ..agents.explanation_agent import ExplanationAgent
from ..agents.scheduling_agent import SchedulingAgent
from ..agents.validation_agent import ValidationAgent
from ..application.telemetry import bind, span


class InsertionWorkflow:
    def __init__(self, model_assistant=None, knowledge_tool=None):
        self.model_assistant = model_assistant
        self.validation = ValidationAgent()
        self.scheduling = SchedulingAgent()
        self.evaluation = EvaluationAgent()
        self.explanation = ExplanationAgent(knowledge_tool=knowledge_tool)

    def __call__(self, request, snapshot, calculate, *, on_progress=None):
        trace_id = f"TRC-{uuid4().hex.upper()}"
        bind(local_trace_id=trace_id)
        trace = []
        started = monotonic()
        model_error = None

        def emit(event):
            if on_progress:
                on_progress(event)

        def run(role, execute, fact=None):
            emit(dict(type="insertion_stage_started", agent=role))
            try:
                with span(role) as node:
                    with span(role + "_tool", "tool"):
                        output = execute()
                    record(
                        role, None if role == "validation" else fact if fact is not None else output
                    )
                    node["mode"] = trace[-1]["mode"]
                    execution = trace[-1].get("execution") or {}
                    if execution.get("error_code"):
                        node["error_code"] = execution["error_code"]
            except Exception:
                emit(dict(type="insertion_stage_failed", agent=role))
                raise
            emit(
                dict(
                    type="insertion_stage_completed",
                    agent=role,
                    mode=trace[-1]["mode"],
                    elapsed_ms=trace[-1]["elapsed_ms"],
                )
            )
            return output

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

        validated = run("validation", lambda: self.validation.run_insertion(request, snapshot))
        result = run("scheduling", lambda: self.scheduling.run_insertion(calculate, snapshot))
        evaluated = run(
            "evaluation", lambda: self.evaluation.run_insertion(result, snapshot, request), result
        )
        explanation = run(
            "explanation",
            lambda: self.explanation.run_insertion(result, request, skip_model_code=model_error),
            result,
        )
        result["workflow"] = dict(
            trace_id=trace_id,
            mode=("fallback" if model_error else "live") if self.model_assistant else "rules",
            trace=trace,
            validation=validated,
            evaluation=evaluated,
            explanation=explanation,
        )
        return result
