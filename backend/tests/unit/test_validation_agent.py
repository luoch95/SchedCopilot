"""Manufacturing input cases and deterministic Agent orchestration failures."""

import copy
import json
from dataclasses import replace
from datetime import timedelta

import pytest

from sched_copilot.agents.contracts import AgentContext, ValidationInput
from sched_copilot.agents.result_validation import AgentContractError, validate_result
from sched_copilot.agents.validation_agent import ValidationAgent
from sched_copilot.prompts import PromptLoader
from sched_copilot.tools.validation import validate_data


@pytest.fixture
def request_data():
    return {
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
            "report_snapshot_at": "2026-10-19T13:00:00+08:00",
            "wip_policy": None,
            "orders": [{"order_id": "O1", "due_at": "2026-10-19T18:00:00+08:00", "priority": 1}],
            "machines": [
                {"machine_id": "M1", "capabilities": ["mold_a"], "available": True},
                {"machine_id": "M2", "capabilities": ["mold_a"], "available": True},
            ],
            "molds": [{"mold_id": "MOLD-A", "compatible_machine_ids": ["M1", "M2"]}],
            "operations": [
                {
                    "operation_id": "OP1",
                    "order_id": "O1",
                    "sequence": 1,
                    "machine_id": "M1",
                    "mold_id": "MOLD-A",
                    "capability": "mold_a",
                    "start_at": "2026-10-19T13:00:00+08:00",
                    "duration_minutes": 60,
                    "status": "planned",
                },
                {
                    "operation_id": "OP2",
                    "order_id": "O1",
                    "sequence": 2,
                    "machine_id": "M2",
                    "mold_id": "MOLD-A",
                    "capability": "mold_a",
                    "start_at": "2026-10-19T14:00:00+08:00",
                    "duration_minutes": 60,
                    "status": "planned",
                },
            ],
            "failures": [
                {
                    "event_id": "F1",
                    "machine_id": "M1",
                    "started_at": "2026-10-19T13:00:00+08:00",
                    "estimated_recovery_at": "2026-10-19T15:00:00+08:00",
                    "received_at": "2026-10-19T13:00:00+08:00",
                    "source": "人工估计",
                }
            ],
        },
    }


def request(data):
    return ValidationInput.model_validate_json(json.dumps(data))


def codes(run):
    return {issue.code for issue in run.result.data.issues}


def test_agent_returns_verified_report_and_new_evidence_without_mutation(request_data, monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    original = request(request_data)
    before = original.model_dump_json()
    run = ValidationAgent().run(original, expected_context=original.context)
    assert original.model_dump_json() == before
    assert run.result.status == "success"
    assert run.result.data.can_generate_candidates
    assert run.request.validation_tool_result == run.result.data
    assert run.result.evidence_refs
    assert run.result.evidence_refs[0] in run.request.evidence_catalog
    assert len(run.prompt_sha256) == 64
    assert (
        validate_result(
            run.result.model_dump_json(), run.request, PromptLoader().load("validation")
        )
        == run.result
    )
    assert "physical_mold_occupancy" in run.result.data.unchecked_items


@pytest.mark.parametrize(
    "field,value,code",
    [
        ("estimated_recovery_at", None, "RECOVERY_TIME_UNKNOWN"),
        ("estimated_recovery_at", "2026-10-19T12:00:00+08:00", "RECOVERY_TIME_INVALID"),
        ("received_at", "2026-10-19T12:00:00+08:00", "EVENT_TIME_INVALID"),
        ("machine_id", "UNKNOWN", "FAILURE_MACHINE_NOT_FOUND"),
    ],
)
def test_fault_input_quality_blocks_candidates(request_data, field, value, code):
    request_data["case_data"]["failures"][0][field] = value
    run = ValidationAgent().run(request(request_data))
    assert run.result.status == ("failed" if code == "FAILURE_MACHINE_NOT_FOUND" else "blocked")
    assert not run.result.data.can_generate_candidates
    assert code in codes(run)
    issue = next(i for i in run.result.data.issues if i.code == code)
    assert issue.impact and issue.repair_hint
    assert all(ref in run.request.evidence_catalog for ref in issue.evidence_refs)


@pytest.mark.parametrize("field", ["orders", "machines", "operations", "failures"])
def test_missing_required_data_is_fatal(request_data, field):
    request_data["case_data"][field] = []
    run = ValidationAgent().run(request(request_data))
    assert run.result.status == "failed"
    assert run.result.quality.score == 0
    assert "MISSING_DATA" in codes(run)


@pytest.mark.parametrize("field", ["orders", "machines", "operations", "molds", "failures"])
def test_duplicate_record_identifiers_are_not_silently_overwritten(request_data, field):
    records = request_data["case_data"][field]
    records.append(copy.deepcopy(records[0]))
    run = ValidationAgent().run(request(request_data))
    assert run.result.status == "blocked"
    assert "DUPLICATE_ID" in codes(run)


def test_duplicate_failure_windows_are_explicit(request_data):
    duplicate = copy.deepcopy(request_data["case_data"]["failures"][0])
    duplicate["event_id"] = "F2"
    request_data["case_data"]["failures"].append(duplicate)
    run = ValidationAgent().run(request(request_data))
    assert "DUPLICATE_EVENT" in codes(run)
    assert "MULTIPLE_FAILURES_UNSUPPORTED" not in codes(run)


def test_independent_failure_windows_are_supported(request_data):
    second = copy.deepcopy(request_data["case_data"]["failures"][0])
    second.update(
        event_id="F2",
        machine_id="M2",
        started_at="2026-10-19T13:00:00+08:00",
        estimated_recovery_at="2026-10-19T15:00:00+08:00",
        received_at="2026-10-19T13:00:00+08:00",
    )
    request_data["case_data"]["failures"].append(second)
    run = ValidationAgent().run(request(request_data))
    assert "DUPLICATE_EVENT" not in codes(run)
    assert "MULTIPLE_FAILURES_UNSUPPORTED" not in codes(run)


@pytest.mark.parametrize(
    "field,value,code",
    [
        ("order_id", "UNKNOWN", "ORDER_NOT_FOUND"),
        ("mold_id", "UNKNOWN", "MOLD_NOT_FOUND"),
        ("machine_id", "UNKNOWN", "INVALID_BASELINE"),
        ("capability", "unsupported", "INVALID_BASELINE"),
        ("status", "completed", "REPORT_STATUS_CONFLICT"),
    ],
)
def test_operation_references_capability_and_status(request_data, field, value, code):
    request_data["case_data"]["operations"][0][field] = value
    run = ValidationAgent().run(request(request_data))
    assert run.result.status == (
        "failed" if code in {"ORDER_NOT_FOUND", "MOLD_NOT_FOUND"} else "blocked"
    )
    assert code in codes(run)


def test_physical_mold_must_be_compatible(request_data):
    request_data["case_data"]["molds"][0]["compatible_machine_ids"] = ["M2"]
    run = ValidationAgent().run(request(request_data))
    assert "MOLD_MACHINE_INCOMPATIBLE" in codes(run)


def test_missing_physical_mold_is_disclosed_not_silently_checked(request_data):
    request_data["case_data"]["operations"][0]["mold_id"] = None
    run = ValidationAgent().run(request(request_data))
    assert run.result.status == "warning"
    assert run.result.data.can_generate_candidates
    assert "MOLD_ASSIGNMENT_MISSING" in codes(run)
    assert "physical_mold_compatibility" in run.result.data.unchecked_items


def test_unavailable_device_without_window_blocks_but_fault_device_can_be_replanned(request_data):
    request_data["case_data"]["machines"][0]["available"] = False
    assert ValidationAgent().run(request(request_data)).result.status == "success"
    request_data["case_data"]["machines"][1]["available"] = False
    assert "MACHINE_UNAVAILABLE" in codes(ValidationAgent().run(request(request_data)))


def test_report_snapshot_and_event_clock_are_explained_separately(request_data):
    request_data["case_data"]["operations"][0]["start_at"] = "2026-10-19T12:00:00+08:00"
    run = ValidationAgent().run(request(request_data))
    assert {"REPORT_STATUS_STALE", "EVENT_REPORT_STALE"} <= codes(run)
    stale = next(i for i in run.result.data.issues if i.code == "EVENT_REPORT_STALE")
    assert "不会自动推进" in stale.impact


@pytest.mark.parametrize(
    "policy,code", [(None, "WIP_POLICY_REQUIRED"), ("原机续加工", "WIP_POLICY_UNSUPPORTED")]
)
def test_in_progress_failure_does_not_pretend_wip_policy_is_implemented(request_data, policy, code):
    op = request_data["case_data"]["operations"][0]
    op.update(start_at="2026-10-19T12:30:00+08:00", status="in_progress")
    request_data["case_data"]["wip_policy"] = policy
    run = ValidationAgent().run(request(request_data))
    assert run.result.status == "blocked"
    assert code in codes(run)


def test_completed_work_ending_at_fault_boundary_is_not_wip(request_data):
    op = request_data["case_data"]["operations"][0]
    op.update(start_at="2026-10-19T12:00:00+08:00", status="completed")
    assert ValidationAgent().run(request(request_data)).result.status == "success"


def test_baseline_order_sequence_conflict_reuses_domain_checker(request_data):
    request_data["case_data"]["operations"][1]["start_at"] = "2026-10-19T13:30:00+08:00"
    run = ValidationAgent().run(request(request_data))
    assert "INVALID_BASELINE" in codes(run)
    assert any("必须先于" in issue.message for issue in run.result.data.issues)


def test_supplied_previous_report_is_not_used_to_bypass_fresh_rules(request_data):
    previous = ValidationAgent().run(request(request_data))
    changed = previous.request.model_dump(mode="json")
    changed["case_data"]["failures"][0]["estimated_recovery_at"] = None
    run = ValidationAgent().run(request(changed))
    assert run.result.status == "blocked"
    assert "RECOVERY_TIME_UNKNOWN" in codes(run)


def test_repeated_run_is_deterministic(request_data):
    agent = ValidationAgent()
    first, second = agent.run(request(request_data)), agent.run(request(request_data))
    assert first.result == second.result
    assert first.request.evidence_catalog == second.request.evidence_catalog


def test_stale_context_is_rejected_before_tool(request_data):
    calls = []
    agent = ValidationAgent(tool=lambda *args: calls.append(args))
    expected = AgentContext.model_validate({**request_data["context"], "event_version": 2})
    with pytest.raises(AgentContractError) as error:
        agent.run(request(request_data), expected_context=expected)
    assert error.value.code == "STALE_CONTEXT"
    assert not calls


def test_tool_exception_is_failed_not_blocked_and_does_not_leak(request_data, caplog):
    def broken(*args):
        raise RuntimeError("secret-api-key")

    run = ValidationAgent(tool=broken).run(request(request_data))
    assert run.result.status == "failed"
    assert run.result.data is None
    assert run.result.errors[0].code == "VALIDATION_TOOL_FAILED"
    assert "secret-api-key" not in run.result.model_dump_json() + caplog.text


def test_invalid_tool_evidence_is_not_accepted(request_data):
    def broken(case, context):
        output = validate_data(case, context)
        ref = next(iter(output.evidence_catalog))
        output.evidence_catalog[ref].context.event_version += 1
        return output

    run = ValidationAgent(tool=broken).run(request(request_data))
    assert run.result.status == "failed"


def test_missing_tool_reference_is_repaired_before_success(request_data):
    def broken(case, context):
        return replace(validate_data(case, context), summary_refs=("invented",))

    run = ValidationAgent(tool=broken).run(request(request_data))
    expected = ValidationAgent().run(request(request_data))
    assert run.result.data == expected.result.data
    assert run.request.evidence_catalog == expected.request.evidence_catalog
    assert run.result.quality.round == 2
    assert run.result.quality.history[0].issues


def test_tool_cannot_mutate_callers_case(request_data):
    original = request(request_data)

    def mutate(case, context):
        case.failures[0].estimated_recovery_at += timedelta(hours=1)
        return validate_data(case, context)

    before = original.model_dump_json()
    run = ValidationAgent(tool=mutate).run(original)
    assert original.model_dump_json() == before
    assert run.result.status == "failed"


def test_existing_injection_molding_demo_passes_with_disclosed_mold_limitations(request_data):
    from sched_copilot.scenarios.demo import (
        EVENT_TIME,
        demo_machines,
        demo_orders,
        demo_schedule,
    )

    case = request_data["case_data"]
    case["report_snapshot_at"] = EVENT_TIME.isoformat()
    case["orders"] = [
        {"order_id": o.id, "due_at": o.due.isoformat(), "priority": o.priority}
        for o in demo_orders()
    ]
    case["machines"] = [
        {"machine_id": m.id, "capabilities": sorted(m.capabilities), "available": True}
        for m in demo_machines()
    ]
    case["operations"] = [
        {
            "operation_id": o.id,
            "order_id": o.order_id,
            "sequence": o.sequence,
            "machine_id": o.machine_id,
            "mold_id": None,
            "capability": o.capability,
            "start_at": o.start.isoformat(),
            "duration_minutes": o.duration_minutes,
            "status": o.status.value,
        }
        for o in demo_schedule().operations
    ]
    case["molds"] = []
    run = ValidationAgent().run(request(request_data))
    assert run.result.status == "warning"
    assert run.result.data.can_generate_candidates
    assert codes(run) == {"MOLD_ASSIGNMENT_MISSING"}


def test_evidence_identity_includes_context_not_just_case_content(request_data):
    agent = ValidationAgent()
    first = agent.run(request(request_data))
    request_data["context"]["event_version"] += 1
    second = agent.run(request(request_data))
    assert set(first.result.evidence_refs).isdisjoint(second.result.evidence_refs)


def test_in_progress_operation_without_remaining_time_is_not_treated_as_finished(request_data):
    op = request_data["case_data"]["operations"][0]
    op.update(status="in_progress", start_at="2026-10-19T11:00:00+08:00")
    run = ValidationAgent().run(request(request_data))
    assert "IN_PROGRESS_STATUS_STALE" in codes(run)
    assert run.result.status == "blocked"


def test_omitted_check_coverage_is_rebuilt(request_data):
    def incomplete(case, context):
        output = validate_data(case, context)
        output.data.checked_items.clear()
        return output

    original = request(request_data)
    run = ValidationAgent(tool=incomplete).run(original)
    assert run.result.data == ValidationAgent().run(original).result.data
    assert run.result.quality.round == 2
    assert run.result.quality.history[0].issues
    assert not run.result.quality.history[-1].issues
