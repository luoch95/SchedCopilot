"""排产执行 Agent 的制造场景、来源约束和工具失败测试。"""

import copy
from dataclasses import replace

import pytest

from sched_copilot.agents.contracts import AgentContext, Evidence, SchedulingInput, ValidationInput
from sched_copilot.agents.contracts.artifacts import CandidateSnapshot
from sched_copilot.agents.result_validation import AgentContractError, validate_result
from sched_copilot.agents.scheduling_agent import SchedulingAgent
from sched_copilot.agents.validation_agent import ValidationAgent
from sched_copilot.domain.errors import RuleViolation
from sched_copilot.prompts import PromptLoader
from sched_copilot.scenarios.demo import EVENT_TIME, demo_machines, demo_orders, demo_schedule
from sched_copilot.tools.scheduling import generate_schedule


def validation_request():
    machines = demo_machines()
    capabilities = sorted({cap for machine in machines for cap in machine.capabilities})
    return ValidationInput.model_validate(
        {
            "agent_name": "validation",
            "intent": "generate_candidates",
            "context": {
                "case_id": "C1",
                "snapshot_id": "S1",
                "event_version": 1,
                "current_plan_version": "P1",
                "input_fingerprint": "input-1",
            },
            "evidence_catalog": {},
            "validation_tool_result": None,
            "case_data": {
                "report_snapshot_at": EVENT_TIME,
                "wip_policy": None,
                "orders": [
                    {"order_id": o.id, "due_at": o.due, "priority": o.priority}
                    for o in demo_orders()
                ],
                "machines": [
                    {"machine_id": m.id, "capabilities": sorted(m.capabilities), "available": True}
                    for m in machines
                ],
                "molds": [
                    {
                        "mold_id": cap,
                        "compatible_machine_ids": [m.id for m in machines if cap in m.capabilities],
                    }
                    for cap in capabilities
                ],
                "operations": [
                    {
                        "operation_id": op.id,
                        "order_id": op.order_id,
                        "sequence": op.sequence,
                        "machine_id": op.machine_id,
                        "mold_id": op.capability,
                        "capability": op.capability,
                        "start_at": op.start,
                        "duration_minutes": op.duration_minutes,
                        "status": op.status.value,
                    }
                    for op in demo_schedule().operations
                ],
                "failures": [
                    {
                        "event_id": "F1",
                        "machine_id": "M1",
                        "started_at": EVENT_TIME,
                        "estimated_recovery_at": EVENT_TIME.replace(hour=17),
                        "received_at": EVENT_TIME,
                        "source": "人工估计",
                    }
                ],
            },
        }
    )


def from_validation(request):
    validated = ValidationAgent().run(request)
    catalog = copy.deepcopy(validated.request.evidence_catalog)
    catalog["validation-result:1"] = Evidence(
        context=validated.result.context,
        kind="validation_result",
        content=validated.result.model_dump(mode="json"),
    )
    case_ref = next(ref for ref in validated.result.evidence_refs if catalog[ref].kind == "case")
    return SchedulingInput.model_validate(
        {
            "agent_name": "scheduling",
            "context": validated.result.context,
            "evidence_catalog": catalog,
            "validation_result_ref": "validation-result:1",
            "current_plan_ref": case_ref,
            "user_constraints": [],
            "allowed_strategies": [
                {"strategy_id": strategy, "description": strategy, "parameters": {}}
                for strategy in ("wait-recovery", "allow-transfer")
            ],
            "wip_policy": validated.request.case_data.wip_policy,
            "scheduling_tool_result": None,
        }
    )


@pytest.fixture(name="scheduling_request")
def scheduling_request():
    return from_validation(validation_request())


def snapshots(run):
    return [
        CandidateSnapshot.model_validate_json(
            __import__("json").dumps(run.request.evidence_catalog[c.plan_ref].content)
        )
        for c in run.result.data.candidates
    ]


def test_generates_two_valid_distinct_candidates_and_keeps_source_unchanged(scheduling_request):
    request = scheduling_request
    before = request.model_dump_json()
    run = SchedulingAgent().run(request, expected_context=request.context)
    assert run.result.status == "success"
    assert len(run.result.data.candidates) == 2
    assert {c.strategy_id for c in run.result.data.candidates} == {
        "wait-recovery",
        "allow-transfer",
    }
    assert request.model_dump_json() == before
    assert run.request.scheduling_tool_result == run.result.data
    assert (
        validate_result(
            run.result.model_dump_json(), run.request, PromptLoader().load("scheduling")
        )
        == run.result
    )
    assert len(run.prompt_sha256) == 64
    for candidate in run.result.data.candidates:
        evidence = run.request.evidence_catalog
        assert evidence[candidate.constraint_check_ref].content["passed"] is True
        assert evidence[candidate.changes_ref].content["items"]


def test_keeps_completed_work_fixed_and_wait_strategy_does_not_transfer(scheduling_request):
    run = SchedulingAgent().run(scheduling_request)
    original = {op.id: op for op in demo_schedule().operations}
    for snapshot in snapshots(run):
        for op in snapshot.operations:
            before = original[op.operation_id]
            if before.status == "completed":
                assert (op.start_at, op.machine_id) == (before.start, before.machine_id)
            if snapshot.strategy_id == "wait-recovery":
                assert op.machine_id == before.machine_id
            if op.status == "planned" and op.machine_id == "M1":
                assert op.start_at >= EVENT_TIME.replace(hour=17)


def test_only_selected_strategy_runs_and_single_result_is_disclosed(scheduling_request):
    scheduling_request.allowed_strategies = scheduling_request.allowed_strategies[:1]
    run = SchedulingAgent().run(scheduling_request)
    assert run.result.status == "warning"
    assert len(run.result.data.candidates) == 1
    assert run.result.data.candidates[0].strategy_id == "wait-recovery"
    assert "SINGLE_CANDIDATE" in {n.code for n in run.result.warnings}


def test_identical_plans_are_merged_instead_of_faking_comparison():
    initial = validation_request()
    initial.case_data.failures[0].machine_id = "M3"
    initial.case_data.failures[0].estimated_recovery_at = EVENT_TIME.replace(minute=1)
    run = SchedulingAgent().run(from_validation(initial))
    assert run.result.status == "warning"
    assert len(run.result.data.candidates) == 1
    assert "DUPLICATE_PLAN_MERGED" in {n.code for n in run.result.warnings}


@pytest.mark.parametrize(
    "change,code",
    [
        ("blocked", "VALIDATION_BLOCKED"),
        ("failed", "VALIDATION_BLOCKED"),
        ("unsupported_strategy", "STRATEGY_UNSUPPORTED"),
        ("parameters", "STRATEGY_PARAMETERS_UNSUPPORTED"),
        ("constraints", "USER_CONSTRAINTS_UNSUPPORTED"),
        ("no_strategies", "INVALID_STRATEGIES"),
        ("duplicate_strategies", "INVALID_STRATEGIES"),
        ("policy", "WIP_POLICY_MISMATCH"),
    ],
)
def test_business_gates_block_before_candidate_tool(scheduling_request, change, code):
    request = scheduling_request
    if change in {"blocked", "failed"}:
        content = request.evidence_catalog[request.validation_result_ref].content
        content["status"] = change
    elif change == "unsupported_strategy":
        request.allowed_strategies[0].strategy_id = "changeover-reorder"
    elif change == "parameters":
        request.allowed_strategies[0].parameters = {"max_delay": 30}
    elif change == "constraints":
        request.user_constraints = ["不能增加延期"]
    elif change == "no_strategies":
        request.allowed_strategies = []
    elif change == "duplicate_strategies":
        request.allowed_strategies.append(request.allowed_strategies[0].model_copy())
    else:
        request.wip_policy = "继续加工"
    calls = []
    run = SchedulingAgent(tool=lambda source: calls.append(source)).run(request)
    assert run.result.status == "blocked"
    assert run.result.data is None
    assert run.result.errors[0].code == code
    assert not calls


def test_unknown_recovery_is_not_passed_to_candidate_generator():
    initial = validation_request()
    initial.case_data.failures[0].estimated_recovery_at = None
    request = from_validation(initial)
    calls = []
    run = SchedulingAgent(tool=lambda source: calls.append(source)).run(request)
    assert run.result.status == "blocked"
    assert not calls


def test_changed_snapshot_cannot_reuse_valid_report(scheduling_request):
    request = scheduling_request
    other = copy.deepcopy(request.evidence_catalog[request.current_plan_ref])
    other.content["failures"][0]["estimated_recovery_at"] = "2026-10-19T18:00:00+08:00"
    request.evidence_catalog["changed-case"] = other
    request.current_plan_ref = "changed-case"
    run = SchedulingAgent().run(request)
    assert run.result.status == "blocked"
    assert run.result.errors[0].code == "VALIDATION_SNAPSHOT_MISMATCH"


def test_changed_check_result_cannot_claim_pass(scheduling_request):
    request = scheduling_request
    report = request.evidence_catalog[request.validation_result_ref].content
    report["data"]["checked_items"].append("invented_check")
    run = SchedulingAgent().run(request)
    assert run.result.status == "blocked"
    assert run.result.errors[0].code == "VALIDATION_RESULT_MISMATCH"


def test_old_rule_version_is_rejected(scheduling_request):
    request = scheduling_request
    report = request.evidence_catalog[request.validation_result_ref].content
    rules_ref = next(
        ref for ref in report["evidence_refs"] if request.evidence_catalog[ref].kind == "rules"
    )
    request.evidence_catalog[rules_ref].content["ruleset_version"] = "obsolete"
    assert SchedulingAgent().run(request).result.errors[0].code == "VALIDATION_RULESET_MISMATCH"


def test_mold_compatibility_restricts_transfer_even_if_machine_has_capability():
    initial = validation_request()
    from sched_copilot.agents.contracts.inputs import MachineSnapshot

    initial.case_data.machines.append(
        MachineSnapshot(machine_id="M0", capabilities=["mold_a"], available=True)
    )
    run = SchedulingAgent().run(from_validation(initial))
    assert run.result.status == "success"
    assert all(op.machine_id != "M0" for snapshot in snapshots(run) for op in snapshot.operations)


def test_unavailable_idle_machine_is_not_selected_for_transfer():
    initial = validation_request()
    from sched_copilot.agents.contracts.inputs import MachineSnapshot

    initial.case_data.machines.append(
        MachineSnapshot(machine_id="M0", capabilities=["mold_a"], available=False)
    )
    next(m for m in initial.case_data.molds if m.mold_id == "mold_a").compatible_machine_ids.append(
        "M0"
    )
    run = SchedulingAgent().run(from_validation(initial))
    assert all(op.machine_id != "M0" for snapshot in snapshots(run) for op in snapshot.operations)


def test_no_qualified_alternative_produces_one_distinct_candidate():
    initial = validation_request()
    # 本案例模具 A 的原设备均为 M1，因此收窄兼容表不会破坏原计划。
    next(m for m in initial.case_data.molds if m.mold_id == "mold_a").compatible_machine_ids = [
        "M1"
    ]
    run = SchedulingAgent().run(from_validation(initial))
    assert run.result.status == "warning"
    assert len(run.result.data.candidates) == 1


def test_missing_physical_mold_retains_upstream_warnings():
    initial = validation_request()
    for op in initial.case_data.operations:
        op.mold_id = None
    run = SchedulingAgent().run(from_validation(initial))
    assert run.result.status == "warning"
    assert "MOLD_ASSIGNMENT_MISSING" in {n.code for n in run.result.warnings}
    for candidate in run.result.data.candidates:
        check = run.request.evidence_catalog[candidate.constraint_check_ref].content
        assert "physical_mold_compatibility" in check["unchecked_items"]
        assert "physical_mold_compatibility" not in check["checked_items"]


def test_no_feasible_candidate_is_business_block(scheduling_request, monkeypatch):
    request = scheduling_request

    def no_candidate(*args, **kwargs):
        raise RuleViolation("没有可用设备")

    monkeypatch.setattr("sched_copilot.tools.scheduling.generate_candidates", no_candidate)
    run = SchedulingAgent().run(request)
    assert run.result.status == "blocked"
    assert run.result.errors[0].code == "NO_FEASIBLE_CANDIDATE"


def test_one_failed_strategy_keeps_other_valid_candidate(scheduling_request, monkeypatch):
    request = scheduling_request
    from sched_copilot.tools.scheduling import generate_candidates as real

    def one_failure(*args, **kwargs):
        if kwargs["strategies"] == ("allow-transfer",):
            raise RuleViolation("转移不可行")
        return real(*args, **kwargs)

    monkeypatch.setattr("sched_copilot.tools.scheduling.generate_candidates", one_failure)
    run = SchedulingAgent().run(request)
    assert run.result.status == "warning"
    assert len(run.result.data.candidates) == 1


def test_tool_exception_does_not_leak_business_data(scheduling_request, caplog):
    request = scheduling_request

    def broken(source):
        raise RuntimeError("secret-api-key")

    run = SchedulingAgent(tool=broken).run(request)
    assert run.result.status == "failed"
    assert run.result.data is None
    assert "secret-api-key" not in run.result.model_dump_json() + caplog.text


def test_fake_pass_record_cannot_authorize_invalid_candidate(scheduling_request):
    request = scheduling_request

    def broken(source):
        output = generate_schedule(source)
        ref = output.data.candidates[0].plan_ref
        output.evidence_catalog[ref].content["operations"][3]["machine_id"] = "unknown"
        return output

    assert SchedulingAgent(tool=broken).run(request).result.status == "failed"


def test_incorrect_change_record_is_rejected(scheduling_request):
    request = scheduling_request

    def broken(source):
        output = generate_schedule(source)
        ref = output.data.candidates[0].changes_ref
        output.evidence_catalog[ref].content["items"][0]["before_machine_id"] = "unknown"
        return output

    assert SchedulingAgent(tool=broken).run(request).result.status == "failed"


def test_empty_tool_result_does_not_claim_success(scheduling_request):
    request = scheduling_request

    def broken(source):
        output = generate_schedule(source)
        output.data.candidates.clear()
        return output

    assert SchedulingAgent(tool=broken).run(request).result.status == "failed"


def test_unknown_tool_reference_is_rejected(scheduling_request):
    request = scheduling_request

    def broken(source):
        return replace(generate_schedule(source), summary_refs=("invented",))

    assert SchedulingAgent(tool=broken).run(request).result.status == "failed"


def test_repeated_run_is_deterministic(scheduling_request):
    first, second = (
        SchedulingAgent().run(scheduling_request),
        SchedulingAgent().run(scheduling_request),
    )
    assert first.result == second.result
    assert first.request.evidence_catalog == second.request.evidence_catalog


def test_stale_context_is_rejected_before_tool(scheduling_request):
    request = scheduling_request
    calls = []
    expected = AgentContext.model_validate({**request.context.model_dump(), "event_version": 2})
    with pytest.raises(AgentContractError) as error:
        SchedulingAgent(tool=lambda source: calls.append(source)).run(
            request, expected_context=expected
        )
    assert error.value.code == "STALE_CONTEXT"
    assert not calls


def test_execution_does_not_call_other_agent_or_need_llm(scheduling_request, monkeypatch):
    request = scheduling_request
    monkeypatch.delenv("LLM_API_KEY", raising=False)

    def forbidden(*args, **kwargs):
        raise AssertionError("排产不能直接调用其他 Agent")

    monkeypatch.setattr(ValidationAgent, "run", forbidden)
    assert SchedulingAgent().run(request).result.status == "success"
