"""Execute typed Agents and retain all tool-created evidence."""

import logging
from collections.abc import Callable
from dataclasses import asdict, dataclass
from hashlib import sha256
from time import monotonic
from uuid import uuid4

from ..agents.contracts.common import Evidence
from ..agents.evaluation_agent import EvaluationAgent
from ..agents.explanation_agent import ExplanationAgent
from ..agents.live_agent import LiveAgent, ModelExecution
from ..agents.quality import quality_progress, validate_handoff
from ..agents.scheduling_agent import SchedulingAgent
from ..agents.validation_agent import ValidationAgent
from .routing import Action, Intent, route
from .state import WorkflowState

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WorkflowTrace:
    action: str
    status: str
    result_ref: str | None
    error_code: str | None = None
    execution: ModelExecution | None = None
    knowledge: dict | None = None
    span_id: str | None = None
    elapsed_ms: int | None = None


@dataclass(frozen=True)
class WorkflowRun:
    state: WorkflowState
    trace: tuple[WorkflowTrace, ...]


class DynamicOrchestrator:
    def __init__(self, validation=None, scheduling=None, evaluation=None, explanation=None):
        self.validation = validation or ValidationAgent()
        self.scheduling = scheduling or SchedulingAgent()
        self.evaluation = evaluation or EvaluationAgent()
        self.explanation = explanation or ExplanationAgent()

    def run(
        self,
        state: WorkflowState,
        *,
        max_steps: int = 6,
        on_progress: Callable[[dict], None] | None = None,
        fallback_demo: Callable[[], None] | None = None,
    ) -> WorkflowRun:
        current = state.model_copy(deep=True)
        current.workflow_status, current.failure_code = "running", None
        trace = []
        try:
            Intent(current.intent)
            for request in self._requests(current):
                if request.context != current.context:
                    raise ValueError("Request context mismatch")
            for evidence in current.evidence_catalog.values():
                if evidence.context != current.context:
                    raise ValueError("Evidence context mismatch")
            for result in self._results(current):
                if result.context != current.context:
                    raise ValueError("Result context mismatch")
        except ValueError:
            current.workflow_status, current.failure_code = "failed", "WORKFLOW_INVALID_STATE"
            return WorkflowRun(
                current, (WorkflowTrace("router", "failed", None, current.failure_code),)
            )
        steps = 0
        if on_progress:
            on_progress(
                {
                    "type": "plan",
                    "actions": {
                        "generate_candidates": ["validate", "schedule", "evaluate", "explain"],
                        "validate": ["validate"],
                        "re_evaluate": ["evaluate"],
                        "explain": ["explain"],
                    }[current.intent],
                }
            )
        while True:
            action = route(current)
            if action is Action.END:
                statuses = {r.status for r in self._results(current)}
                current.workflow_status = (
                    "failed"
                    if "failed" in statuses
                    else "blocked"
                    if "blocked" in statuses
                    else "completed"
                )
                break
            if steps >= max_steps:
                current.workflow_status, current.failure_code = "failed", "WORKFLOW_STEP_LIMIT"
                trace.append(WorkflowTrace("router", "failed", None, current.failure_code))
                break
            simulate_failure = action is Action.SCHEDULE and fallback_demo is not None
            if simulate_failure:
                # Claim outside Agent error handling: a concurrent cooldown
                # rejection is a request conflict, not a broken business Agent.
                fallback_demo()
            steps += 1
            started = monotonic()
            span_id = f"SPN-{uuid4().hex}"
            try:
                self._sync_requests(current)
                name = self._agent(action)
                request = getattr(current, f"{name}_input")
                if request is None:
                    raise ValueError("Missing Agent input")
                if on_progress:
                    on_progress({"type": "stage_started", "action": action.value})
                agent = getattr(self, name)
                if simulate_failure and not isinstance(agent, LiveAgent):
                    agent = LiveAgent(name, agent, lambda: None, None)

                def emit_quality(event):
                    if on_progress:
                        on_progress({**event, "action": action.value})

                with quality_progress(emit_quality):
                    run = agent.run(
                        request.model_copy(deep=True),
                        expected_context=current.context,
                        **({"simulate_failure": True} if simulate_failure else {}),
                    )
                result = validate_handoff(run, name)
                if result.context != current.context or result.agent_name != name:
                    raise ValueError("Agent result mismatch")
                for ref, evidence in run.request.evidence_catalog.items():
                    if evidence.context != current.context:
                        raise ValueError("Agent evidence mismatch")
                    if (
                        ref in current.evidence_catalog
                        and current.evidence_catalog[ref] != evidence
                    ):
                        raise ValueError("Evidence collision")
                current.evidence_catalog.update(run.request.evidence_catalog)
                ref = self._record_result(action, result, current)
                error_code = result.errors[0].code if result.errors else None
                trace.append(
                    WorkflowTrace(
                        action.value,
                        result.status,
                        ref,
                        error_code,
                        getattr(run, "execution", None),
                        getattr(run, "knowledge", None),
                        span_id,
                        round((monotonic() - started) * 1000),
                    )
                )
                if on_progress:
                    on_progress(
                        {
                            "type": "stage_completed",
                            "action": action.value,
                            "step": asdict(trace[-1]),
                            "name": name,
                            "report": result.model_dump(mode="json"),
                        }
                    )
            except Exception as exc:
                logger.warning("Workflow Agent failed: %s", type(exc).__name__)
                current.workflow_status, current.failure_code = "failed", "WORKFLOW_AGENT_FAILED"
                trace.append(
                    WorkflowTrace(
                        action.value,
                        "failed",
                        None,
                        current.failure_code,
                        span_id=span_id,
                        elapsed_ms=round((monotonic() - started) * 1000),
                    )
                )
                if on_progress:
                    on_progress(
                        {
                            "type": "stage_completed",
                            "action": action.value,
                            "step": asdict(trace[-1]),
                            "name": self._agent(action),
                            "report": None,
                        }
                    )
                break
        self._sync_requests(current)
        return WorkflowRun(current, tuple(trace))

    @staticmethod
    def _agent(action):
        return {
            Action.VALIDATE: "validation",
            Action.SCHEDULE: "scheduling",
            Action.EVALUATE: "evaluation",
            Action.EXPLAIN: "explanation",
        }[action]

    @staticmethod
    def _requests(state):
        return [
            r
            for r in (
                state.validation_input,
                state.scheduling_input,
                state.evaluation_input,
                state.explanation_input,
            )
            if r is not None
        ]

    @staticmethod
    def _results(state):
        return [
            r
            for r in (
                state.validation_result,
                state.scheduling_result,
                state.evaluation_result,
                state.explanation_result,
            )
            if r is not None
        ]

    @staticmethod
    def _record_result(action, result, state):
        fingerprint = sha256(result.model_dump_json().encode()).hexdigest()
        ref = f"workflow:{result.agent_name}:result:{fingerprint}"
        state.evidence_catalog[ref] = Evidence(
            context=state.context,
            kind=f"{result.agent_name}_result",
            content=result.model_dump(mode="json"),
        )
        setattr(state, f"{result.agent_name}_result", result)
        field = (
            "candidate_batch_ref"
            if action is Action.SCHEDULE
            else f"{result.agent_name}_result_ref"
        )
        setattr(state, field, ref)
        return ref

    @staticmethod
    def _sync_requests(state):
        updates = {"evidence_catalog": state.evidence_catalog}
        case_ref = next(
            (ref for ref, e in state.evidence_catalog.items() if e.kind == "case"), None
        )
        if state.validation_result_ref:
            updates["validation_result_ref"] = state.validation_result_ref
        if case_ref:
            updates["current_plan_ref"] = case_ref
        if state.scheduling_input:
            state.scheduling_input = state.scheduling_input.model_copy(update=updates)
        if state.evaluation_input:
            evaluation = {k: v for k, v in updates.items() if k != "validation_result_ref"}
            if state.scheduling_result and state.scheduling_result.data:
                evaluation.update(
                    candidate_batch_id=state.scheduling_result.data.candidate_batch_id,
                    candidate_refs={
                        c.candidate_id: c.plan_ref for c in state.scheduling_result.data.candidates
                    },
                )
            state.evaluation_input = state.evaluation_input.model_copy(update=evaluation)
        if state.explanation_input:
            question = state.explanation_input.question
            if (
                state.intent == "generate_candidates"
                and state.scheduling_result
                and state.scheduling_result.data
                and len(state.scheduling_result.data.candidates) == 1
            ):
                question = "解释唯一可行候选的影响、风险和限制，说明没有其他不同方案"
            if (
                state.intent == "generate_candidates"
                and state.validation_result
                and state.validation_result.status == "blocked"
            ):
                question = "解释数据校验阻断原因和修复步骤"
            state.explanation_input = state.explanation_input.model_copy(
                update={
                    "question": question,
                    "evidence_catalog": state.evidence_catalog,
                    "validation_result_ref": state.validation_result_ref,
                    "candidate_batch_ref": state.candidate_batch_ref,
                    "evaluation_result_ref": state.evaluation_result_ref,
                }
            )
        if state.validation_input:
            state.validation_input = state.validation_input.model_copy(
                update={"evidence_catalog": state.evidence_catalog}
            )
