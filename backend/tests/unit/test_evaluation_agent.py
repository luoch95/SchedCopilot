"""评估已有候选、缺失指标披露、来源校验与工具故障回归。"""

from dataclasses import replace
from datetime import timedelta

import pytest
from test_scheduling_agent import from_validation, validation_request

from sched_copilot.agents.contracts import AgentContext, EvaluationInput
from sched_copilot.agents.evaluation_agent import EvaluationAgent
from sched_copilot.agents.result_validation import AgentContractError, validate_result
from sched_copilot.agents.scheduling_agent import SchedulingAgent
from sched_copilot.domain.evaluation import compare_plans
from sched_copilot.domain.models import Operation, Order, Schedule
from sched_copilot.prompts import PromptLoader
from sched_copilot.scenarios.demo import EVENT_TIME
from sched_copilot.tools.evaluation import evaluate_candidates


@pytest.fixture
def evaluation_request():
    run = SchedulingAgent().run(from_validation(validation_request()))
    return EvaluationInput(
        agent_name="evaluation",
        context=run.request.context,
        evidence_catalog=run.request.evidence_catalog,
        current_plan_ref=run.request.current_plan_ref,
        candidate_batch_id=run.result.data.candidate_batch_id,
        candidate_refs={c.candidate_id: c.plan_ref for c in run.result.data.candidates},
        evaluation_criteria_ref=None,
        evaluation_tool_result=None,
    )


def metrics(run):
    return [
        run.request.evidence_catalog[e.metrics_ref].content for e in run.result.data.evaluations
    ]


def test_evaluates_existing_candidates_with_evidence_and_missing_metrics(
    evaluation_request, monkeypatch
):
    before = evaluation_request.model_dump_json()

    def forbidden(*args, **kwargs):
        raise AssertionError("评估不允许重新排产")

    monkeypatch.setattr(SchedulingAgent, "run", forbidden)
    monkeypatch.setattr("sched_copilot.tools.scheduling.generate_candidates", forbidden)
    run = EvaluationAgent().run(evaluation_request, expected_context=evaluation_request.context)
    assert run.result.status == "warning"
    assert len(run.result.data.evaluations) == 2
    assert len(run.result.data.tradeoffs) == 1
    assert evaluation_request.model_dump_json() == before
    assert (
        validate_result(
            run.result.model_dump_json(), run.request, PromptLoader().load("evaluation")
        )
        == run.result
    )
    a, b = metrics(run)
    assert a["transferred_operations"] == 0
    assert b["transferred_operations"] > 0
    assert b["total_lateness_minutes"] < a["total_lateness_minutes"]
    for item in run.result.data.evaluations:
        assert "extra_changeovers" in item.missing_metrics
        assert item.risks
        assert run.request.evidence_catalog[item.differences_ref].content["operations"]
    for m in metrics(run):
        assert m["extra_changeovers"] is None
        assert sum(load["delta_minutes"] for load in m["machine_loads"]) == 0


def test_exact_delay_and_load_definitions_with_existing_lateness_and_inactive_order():
    start = EVENT_TIME
    op = Operation("op", "order", 1, "cap", "M1", 60, start)
    baseline = Schedule(1, (op,))
    candidate = Schedule(1, (op.move_to("M2", start + timedelta(minutes=30, seconds=30)),))
    orders = (
        Order("order", "order", start + timedelta(minutes=45), 1),
        Order("inactive", "inactive", start, 0),
    )
    result, diff = compare_plans(baseline, candidate, orders, ["M1", "M2", "idle"])
    assert result["baseline_total_lateness_minutes"] == 15
    assert result["total_lateness_minutes"] == 45.5
    assert result["total_operation_delay_minutes"] == 30.5
    assert diff["orders"][0]["lateness_delta_minutes"] == 30.5
    assert result["orders_without_operations"] == ["inactive"]
    assert [m["delta_minutes"] for m in result["machine_loads"]] == [-60, 60, 0]
    assert result["moved_operations"] == result["transferred_operations"] == 1


@pytest.mark.parametrize(
    "change",
    [
        "batch",
        "candidate",
        "source",
        "constraints",
        "definition",
        "manifest",
        "changes",
        "criteria",
        "empty",
    ],
)
def test_invalid_source_blocks_before_tool(evaluation_request, change):
    ref = next(iter(evaluation_request.candidate_refs.values()))
    catalog = evaluation_request.evidence_catalog
    if change == "batch":
        evaluation_request.candidate_batch_id = "other-batch"
    elif change == "candidate":
        evaluation_request.candidate_refs = {"unknown-candidate": ref}
    elif change == "source":
        catalog[ref].content["source_plan_ref"] = "unknown"
    elif change == "definition":
        catalog[ref].content["operations"][0]["duration_minutes"] += 1
    elif change == "manifest":
        for evidence in catalog.values():
            if evidence.kind == "candidate_batch":
                evidence.content["candidates"] = []
    elif change == "criteria":
        evaluation_request.evaluation_criteria_ref = evaluation_request.current_plan_ref
    elif change == "empty":
        evaluation_request.candidate_refs = {}
    else:
        kind = "candidate_constraints" if change == "constraints" else "candidate_changes"
        evidence = next(e for e in catalog.values() if e.kind == kind)
        if change == "constraints":
            evidence.content["passed"] = False
        else:
            evidence.content["items"] = []
    calls = []
    run = EvaluationAgent(tool=lambda source: calls.append(source)).run(evaluation_request)
    assert run.result.status == "blocked"
    assert run.result.data is None
    assert not calls


def test_context_and_evidence_rejected_before_tool(evaluation_request):
    changed = AgentContext.model_validate(
        {**evaluation_request.context.model_dump(), "event_version": 99}
    )
    with pytest.raises(AgentContractError, match="版本"):
        EvaluationAgent().run(evaluation_request, expected_context=changed)
    next(iter(evaluation_request.evidence_catalog.values())).context = changed
    with pytest.raises(AgentContractError) as exc:
        EvaluationAgent().run(evaluation_request)
    assert exc.value.code == "STALE_EVIDENCE"


@pytest.mark.parametrize("change", ["metric", "diff", "empty", "ref", "mutation"])
def test_invalid_tool_output_fails(evaluation_request, change):
    def tool(source):
        output = evaluate_candidates(source)
        evaluation = output.data.evaluations[0]
        if change == "metric":
            output.evidence_catalog[evaluation.metrics_ref].content["late_orders"] = 999
        elif change == "diff":
            output.evidence_catalog[evaluation.differences_ref].content["operations"] = []
        elif change == "empty":
            output.data.evaluations.clear()
        elif change == "mutation":
            source.case.orders[0].priority = 999
            return evaluate_candidates(source)
        else:
            return replace(output, summary_refs=("invented",))
        return output

    run = EvaluationAgent(tool=tool).run(evaluation_request)
    assert run.result.status == "failed"
    assert run.result.errors[0].code == "EVALUATION_TOOL_FAILED"
    assert run.result.data is None


def test_tool_exception_is_sanitized(evaluation_request, caplog):
    def tool(source):
        raise RuntimeError("secret-api-key")

    run = EvaluationAgent(tool=tool).run(evaluation_request)
    assert run.result.status == "failed"
    assert "secret-api-key" not in run.result.model_dump_json() + caplog.text


def test_repeated_evaluation_is_deterministic_and_ignores_old_result(evaluation_request):
    first = EvaluationAgent().run(evaluation_request)
    evaluation_request.evidence_catalog = first.request.evidence_catalog
    evaluation_request.evaluation_tool_result = first.result.data.model_copy(deep=True)
    evaluation_request.evaluation_tool_result.evaluations[0].missing_metrics = []
    second = EvaluationAgent().run(evaluation_request)
    assert first.result == second.result
    assert first.request.evidence_catalog == second.request.evidence_catalog
    # 已携带上一轮评价证据的请求同样可重算。
    third = EvaluationAgent().run(first.request)
    assert third.result == first.result


def test_single_candidate_can_compare_to_baseline(evaluation_request):
    evaluation_request.candidate_refs = dict(list(evaluation_request.candidate_refs.items())[:1])
    run = EvaluationAgent().run(evaluation_request)
    assert run.result.status == "warning"
    assert len(run.result.data.evaluations) == 1
    assert not run.result.data.tradeoffs
    assert "SINGLE_CANDIDATE" in {n.code for n in run.result.warnings}


def test_unknown_reference_rejected(evaluation_request):
    evaluation_request.candidate_refs = {"unknown": "unknown"}
    with pytest.raises(AgentContractError) as exc:
        EvaluationAgent().run(evaluation_request)
    assert exc.value.code == "UNKNOWN_REFERENCE"


@pytest.mark.parametrize("change", ["version", "end_time", "change_ref", "snapshot", "priority"])
def test_inconsistent_upstream_evidence_blocks(evaluation_request, change):
    catalog = evaluation_request.evidence_catalog
    if change == "version":
        next(e for e in catalog.values() if e.kind == "validation_result").content[
            "requirements_version"
        ] = "V1.0"
    elif change == "snapshot":
        catalog[evaluation_request.current_plan_ref].content["operations"][0]["start_at"] = (
            EVENT_TIME + timedelta(minutes=1)
        ).isoformat()
    elif change == "priority":
        catalog[evaluation_request.current_plan_ref].content["orders"][0]["priority"] += 1
    else:
        item = next(e for e in catalog.values() if e.kind == "candidate_changes").content["items"][
            0
        ]
        if change == "end_time":
            item["after_end"] = EVENT_TIME.isoformat()
        else:
            item["evidence_refs"] = ["invented"]
    run = EvaluationAgent().run(evaluation_request)
    assert run.result.status == "blocked"
    assert run.result.errors[0].code == "EVALUATION_INCOMPLETE"


def test_identical_plan_has_zero_change_metrics():
    op = Operation("op", "order", 1, "cap", "M1", 60, EVENT_TIME)
    schedule = Schedule(1, (op,))
    result, diff = compare_plans(
        schedule,
        schedule,
        (Order("order", "order", EVENT_TIME + timedelta(hours=2), 1),),
        ["M1"],
    )
    assert result["moved_operations"] == 0
    assert result["transferred_operations"] == 0
    assert result["late_orders"] == 0
    assert result["completion_delta_minutes"] == 0
    assert diff["operations"] == []
