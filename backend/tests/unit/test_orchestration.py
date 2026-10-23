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


def test_workflow_orders_active_failure_before_other_outages():
    active = MachineFailure("M2", EVENT_TIME, EVENT_TIME + timedelta(hours=2), "active", EVENT_TIME)
    m3 = MachineFailure("M3", EVENT_TIME, EVENT_TIME + timedelta(hours=4), "other", EVENT_TIME)
    engine = WorkflowEngine(failure_provider=lambda: (m3, active))

    ordered = engine._ordered_failures(active)

    assert ordered == (active, m3)


def test_workflow_snapshot_invalidates_when_another_outage_changes():
    active = MachineFailure("M2", EVENT_TIME, EVENT_TIME + timedelta(hours=2), "active", EVENT_TIME)
    m3 = MachineFailure("M3", EVENT_TIME, EVENT_TIME + timedelta(hours=4), "other", EVENT_TIME)
    windows = [active, m3]
    engine = WorkflowEngine(failure_provider=lambda: tuple(windows))
    args = (demo_schedule(), active, demo_machines(), demo_orders(), EVENT_TIME, 3)
    fingerprint = engine._fingerprint(*args, None, engine._ordered_failures(active))
    payload = {"context": {"input_fingerprint": fingerprint}}
    assert engine.matches_snapshot(payload, *args)
    windows.pop()
    assert not engine.matches_snapshot(payload, *args)


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
    assert [(e["type"], e["action"]) for e in events[1:] if e["type"].startswith("stage_")] == [
        (kind, action) for action in actions(run) for kind in ("stage_started", "stage_completed")
    ]
    checked = [e for e in events if e["type"] == "quality_checked"]
    assert [e["action"] for e in checked] == actions(run)
    assert all(e["round"] == 1 and e["outcome"] == "passed" for e in checked)
    completed = [e for e in events if e["type"] == "stage_completed"]
    for event, step in zip(completed, run.trace, strict=True):
        assert event["step"]["status"] == step.status
        assert event["report"]["status"] == step.status


def test_progress_does_not_start_skipped_agents_after_validation_block(state):
    state.validation_input.case_data.failures[0].estimated_recovery_at = None
    events = []
    run = DynamicOrchestrator().run(state, on_progress=events.append)
    assert run.state.workflow_status == "blocked"
    assert [e["action"] for e in events if e["type"] == "stage_started"] == ["validate"]


def test_blocked_validation_stops_and_preserves_specific_reason(state):
    state.validation_input.case_data.failures[0].estimated_recovery_at = None
    run = DynamicOrchestrator().run(state)
    assert actions(run) == ["validate"]
    assert run.state.workflow_status == "blocked"
    assert run.state.scheduling_result is None
    assert run.state.explanation_result is None
    assert run.state.validation_result.errors[0].code == "RECOVERY_TIME_UNKNOWN"
    assert run.state.validation_result.quality.score == 0


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


def test_repair_events_finish_before_next_agent_starts(state):
    from sched_copilot.agents.scheduling_agent import SchedulingAgent
    from sched_copilot.tools.scheduling import generate_schedule

    def invalid(source):
        output = generate_schedule(source)
        output.data.candidates.clear()
        return output

    events = []
    run = DynamicOrchestrator(scheduling=SchedulingAgent(tool=invalid)).run(
        state, on_progress=events.append
    )
    assert run.state.workflow_status == "completed"
    assert run.state.scheduling_result.quality.round == 2
    repaired = next(
        i
        for i, e in enumerate(events)
        if e["type"] == "quality_phase" and e["action"] == "schedule" and e["phase"] == "repairing"
    )
    checked = next(
        i
        for i, e in enumerate(events)
        if e["type"] == "quality_checked" and e["action"] == "schedule" and e["round"] == 2
    )
    evaluated = next(
        i
        for i, e in enumerate(events)
        if e["type"] == "stage_started" and e["action"] == "evaluate"
    )
    assert repaired < checked < evaluated


def test_repair_failure_drops_candidate_evidence_and_stops_downstream(state, monkeypatch):
    from sched_copilot.agents.scheduling_agent import SchedulingAgent
    from sched_copilot.tools.scheduling import generate_schedule

    def invalid(source):
        output = generate_schedule(source)
        output.data.candidates.clear()
        return output

    monkeypatch.setattr("sched_copilot.agents.scheduling_agent.generate_schedule", invalid)
    run = DynamicOrchestrator(scheduling=SchedulingAgent(tool=invalid)).run(state)
    result = run.state.scheduling_result
    assert result.status in {"blocked", "failed"}
    assert result.quality.outcome in {"blocked", "failed"}
    assert result.quality.round == 2
    assert result.data is None
    assert run.state.evaluation_result is None
    assert run.state.explanation_result is None
    assert not any(
        e.kind in {"candidate_plan", "candidate_batch", "candidate_constraints"}
        for e in run.state.evidence_catalog.values()
    )


def test_agent_without_quality_report_cannot_handoff(state):
    from dataclasses import replace

    from sched_copilot.agents.validation_agent import ValidationAgent

    class Unchecked:
        def run(self, request, **kwargs):
            run = ValidationAgent().run(request, **kwargs)
            return replace(run, result=run.result.model_copy(update={"quality": None}))

    run = DynamicOrchestrator(validation=Unchecked()).run(state)
    assert run.state.workflow_status == "failed"
    assert run.state.validation_result is None
    assert run.state.scheduling_result is None
    assert actions(run) == ["validate"]


def test_fatal_missing_machine_stops_with_explicit_reason(state):
    state.validation_input.case_data.failures[0].machine_id = "UNKNOWN"
    run = DynamicOrchestrator().run(state)
    assert actions(run) == ["validate"]
    assert run.state.workflow_status == "failed"
    assert run.state.validation_result.quality.score == 0
    assert any("UNKNOWN" in e.message for e in run.state.validation_result.errors)
    assert run.state.scheduling_result is None


def test_optional_missing_data_continues_with_reduced_scores_and_forced_risk(state):
    run = DynamicOrchestrator().run(state)
    assert run.state.workflow_status == "completed"
    assert run.state.validation_result.status == "warning"
    assert run.state.validation_result.quality.score == 98
    for role in ("scheduling", "evaluation", "explanation"):
        assert getattr(run.state, f"{role}_result").quality.score == 70
    explanation = run.state.explanation_result.data
    assert "⚠️ 风险提示" in explanation.summary
    assert "人员配置" in explanation.summary
    assert "物料可用性" in explanation.summary
    assert explanation.risks[0].evidence_refs


def test_no_capacity_continues_to_human_review_without_fabricating_plan(state, monkeypatch):
    from sched_copilot.domain.errors import RuleViolation

    def overloaded(*args, **kwargs):
        raise RuleViolation("产能超载，当前班次内无可用时段")

    monkeypatch.setattr("sched_copilot.tools.scheduling.generate_candidates", overloaded)
    run = DynamicOrchestrator().run(state)
    assert actions(run) == ["validate", "schedule", "evaluate", "explain"]
    assert run.state.workflow_status == "completed"
    assert run.state.scheduling_result.data is None
    assessment = run.state.evaluation_result.data.assessment
    assert assessment.outcome == "no_feasible_candidate"
    assert any("加班" in item and "不是可发布计划" in item for item in assessment.recommendations)
    assert not run.state.evaluation_result.data.evaluations
    assert any("加班" in step.action for step in run.state.explanation_result.data.next_steps)
    assert all(s.requires_human_confirmation for s in run.state.explanation_result.data.next_steps)


@pytest.mark.parametrize("score", [None, 97.99, 100.0])
def test_missing_or_forged_new_validation_score_cannot_handoff(state, score):
    from dataclasses import replace

    from sched_copilot.agents.validation_agent import ValidationAgent

    class Forged:
        def run(self, request, **kwargs):
            run = ValidationAgent().run(request, **kwargs)
            quality = run.result.quality.model_copy(update={"score": score})
            return replace(run, result=run.result.model_copy(update={"quality": quality}))

    run = DynamicOrchestrator(validation=Forged()).run(state)
    assert run.state.workflow_status == "failed"
    assert actions(run) == ["validate"]
    assert run.state.scheduling_result is None
