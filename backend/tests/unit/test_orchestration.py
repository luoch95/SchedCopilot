"""Real four-Agent paths, evidence continuity and terminal states."""

from datetime import timedelta

import pytest

from sched_copilot.agents.contracts import AgentContext
from sched_copilot.agents.evaluation_agent import EvaluationAgent
from sched_copilot.domain.models import MachineFailure
from sched_copilot.orchestration import DynamicOrchestrator
from sched_copilot.orchestration.engine import WorkflowEngine
from sched_copilot.scenarios.demo import EVENT_TIME, demo_machines, demo_orders, demo_schedule


@pytest.fixture
def state():
    engine = WorkflowEngine()
    return engine._initial(
        AgentContext(
            case_id="C1",
            snapshot_id="S1",
            event_version=1,
            current_plan_version="1",
            input_fingerprint="input-1",
        ),
        demo_schedule(),
        MachineFailure("M1", EVENT_TIME, EVENT_TIME + timedelta(hours=4), "manual", EVENT_TIME),
        demo_machines(),
        demo_orders(),
        EVENT_TIME,
        "解释候选方案的取舍和风险",
        "generate_candidates",
    )


def actions(run):
    return [t.action for t in run.trace]


def test_evaluation_tool_failure_preserves_error_and_stops_explanation(state):
    def broken(*args):
        raise RuntimeError("private detail")

    run = DynamicOrchestrator(evaluation=EvaluationAgent(tool=broken)).run(state)
    assert actions(run) == ["validate", "schedule", "evaluate"]
    assert run.state.workflow_status == "failed"
    assert run.trace[-1].error_code == "EVALUATION_TOOL_FAILED"
    assert run.state.explanation_result is None


def test_full_path_preserves_evidence_and_input(state):
    before = state.model_dump_json()
    runner = DynamicOrchestrator()
    run = runner.run(state, max_steps=4)
    assert actions(run) == ["validate", "schedule", "evaluate", "explain"]
    assert run.state.workflow_status == "completed"
    assert state.model_dump_json() == before
    assert run.state.scheduling_result.data
    assert run.state.evaluation_result.data
    assert run.state.explanation_result.data.tradeoffs
    for result in runner._results(run.state):
        assert set(result.evidence_refs) <= run.state.evidence_catalog.keys()
    assert not runner.run(run.state).trace


def test_progress_matches_real_agent_boundaries_and_reports(state):
    events = []
    runner = DynamicOrchestrator()
    validation_run = runner.validation.run

    def validate(*args, **kwargs):
        assert events[-1] == {"type": "stage_started", "action": "validate"}
        assert not any(e["type"] == "stage_completed" for e in events)
        return validation_run(*args, **kwargs)

    runner.validation.run = validate
    run = runner.run(state, on_progress=events.append)
    assert events[0] == {"type": "plan", "actions": actions(run)}
    assert [(e["type"], e["action"]) for e in events[1:]] == [
        (kind, action) for action in actions(run) for kind in ("stage_started", "stage_completed")
    ]
    completed = [e for e in events if e["type"] == "stage_completed"]
    for event, step in zip(completed, run.trace, strict=True):
        assert event["step"]["status"] == step.status
        assert event["report"]["status"] == step.status


def test_progress_does_not_start_skipped_agents_after_validation_block(state):
    state.validation_input.case_data.failures[0].estimated_recovery_at = None
    events = []
    run = DynamicOrchestrator().run(state, on_progress=events.append)
    assert run.state.workflow_status == "blocked"
    assert [e["action"] for e in events if e["type"] == "stage_started"] == ["validate", "explain"]


def test_blocked_validation_explains_once_and_preserves_blocked(state):
    state.validation_input.case_data.failures[0].estimated_recovery_at = None
    run = DynamicOrchestrator().run(state)
    assert actions(run) == ["validate", "explain"]
    assert run.state.workflow_status == "blocked"
    assert run.state.scheduling_result is None
    assert run.state.explanation_result.data


@pytest.mark.parametrize(
    "intent, expected",
    [("validate", ["validate"]), ("explain", ["explain"]), ("re_evaluate", ["evaluate"])],
)
def test_independent_intents(state, intent, expected):
    initial = DynamicOrchestrator().run(state).state
    initial.intent = intent
    if intent == "validate":
        initial.validation_result = None
    elif intent == "explain":
        initial.explanation_result = None
    else:
        initial.evaluation_result = None
    run = DynamicOrchestrator().run(initial)
    assert actions(run) == expected
    assert run.state.workflow_status == "completed"


@pytest.mark.parametrize("name", ["scheduling", "evaluation"])
@pytest.mark.parametrize("status", ["blocked", "failed"])
def test_failed_dependency_stops(state, name, status):
    runner = DynamicOrchestrator()
    finished = runner.run(state).state
    result = getattr(finished, f"{name}_result").model_copy(update={"status": status, "data": None})
    setattr(finished, f"{name}_result", result)
    finished.explanation_result = None
    if name == "scheduling":
        finished.evaluation_result = None
    run = runner.run(finished)
    assert not run.trace
    assert run.state.workflow_status == status


def test_missing_input_and_tool_exception_are_safe(state, caplog):
    state.scheduling_input = None
    run = DynamicOrchestrator().run(state)
    assert actions(run) == ["validate", "schedule"]
    assert run.state.failure_code == "WORKFLOW_AGENT_FAILED"

    class Broken:
        def run(self, *args, **kwargs):
            raise RuntimeError("secret-provider-value")

    run = DynamicOrchestrator(validation=Broken()).run(state)
    assert run.state.workflow_status == "failed"
    assert "secret-provider-value" not in caplog.text


@pytest.mark.parametrize("part", ["request", "result", "evidence"])
def test_stale_context_rejected_before_agents(state, part):
    if part != "request":
        state = DynamicOrchestrator().run(state).state
    if part == "request":
        state.validation_input.context = state.context.model_copy(update={"event_version": 9})
    elif part == "result":
        state.validation_result = state.validation_result.model_copy(
            update={"context": state.context.model_copy(update={"event_version": 9})}
        )
    else:
        ref = next(iter(state.evidence_catalog))
        state.evidence_catalog[ref] = state.evidence_catalog[ref].model_copy(
            update={"context": state.context.model_copy(update={"event_version": 9})}
        )
    run = DynamicOrchestrator().run(state)
    assert run.state.failure_code == "WORKFLOW_INVALID_STATE"
    assert actions(run) == ["router"]


def test_step_limit_and_unknown_intent(state):
    run = DynamicOrchestrator().run(state, max_steps=1)
    assert run.state.failure_code == "WORKFLOW_STEP_LIMIT"
    state.intent = "unknown"
    assert DynamicOrchestrator().run(state).state.failure_code == "WORKFLOW_INVALID_STATE"
