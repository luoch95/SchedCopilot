"""Validate the model boundary without calling an LLM or executing scheduling."""

import copy
import json

import pytest
from pydantic import ValidationError

from sched_copilot.agents.contracts import AgentContext, ExplanationInput
from sched_copilot.agents.result_validation import (
    AgentContractError,
    validate_request,
    validate_result,
)
from sched_copilot.prompts import PromptLoader

CONTEXT = {
    "case_id": "CASE-1",
    "snapshot_id": "SNAP-1",
    "event_version": 2,
    "current_plan_version": "PLAN-1",
    "input_fingerprint": "fingerprint-1",
}


def envelope(role, data, status="success"):
    return {
        "agent_name": role,
        "prompt_version": "1.1.0",
        "requirements_version": "V1.1",
        "context": copy.deepcopy(CONTEXT),
        "status": status,
        "data": data,
        "evidence_refs": ["source:1"],
        "warnings": [],
        "errors": [],
    }


def notice():
    return {"code": "MISSING", "message": "缺少数据", "repair_hint": "请补充", "evidence_refs": []}


def scenario(role):
    validation = {
        "can_generate_candidates": True,
        "checked_items": ["event_time"],
        "unchecked_items": [],
        "issues": [],
    }
    candidates = {
        "candidate_batch_id": "BATCH-1",
        "assumptions": [],
        "limitations": [],
        "candidates": [
            {
                "candidate_id": f"C{i}",
                "strategy_id": "delay",
                "plan_ref": f"plan:C{i}",
                "changes_ref": f"changes:C{i}",
                "constraint_check_ref": f"check:C{i}",
                "evidence_refs": ["source:1"],
            }
            for i in (1, 2)
        ],
    }
    evaluation = {
        "candidate_batch_id": "BATCH-1",
        "criteria_ref": None,
        "tradeoffs": [],
        "evaluations": [
            {
                "candidate_id": f"C{i}",
                "metrics_ref": f"metrics:C{i}",
                "differences_ref": f"diff:C{i}",
                "risks": [],
                "missing_metrics": [],
                "evidence_refs": ["source:1"],
            }
            for i in (1, 2)
        ],
    }
    refs = ["source:1", "validation:1", "baseline:1", "batch:1", "evaluation:1"]
    refs += [
        f"{kind}:C{i}" for i in (1, 2) for kind in ("plan", "changes", "check", "metrics", "diff")
    ]
    catalog = {
        ref: {"context": copy.deepcopy(CONTEXT), "kind": "test", "content": {"fact": "事实"}}
        for ref in refs
    }
    catalog["validation:1"]["content"] = envelope("validation", validation)
    request = {"agent_name": role, "context": copy.deepcopy(CONTEXT), "evidence_catalog": catalog}
    if role == "validation":
        request.update(
            intent="generate",
            case_data={
                "report_snapshot_at": "2026-10-19T13:00:00+08:00",
                "orders": [],
                "operations": [],
                "machines": [],
                "molds": [],
                "failures": [],
                "wip_policy": None,
            },
            validation_tool_result=validation,
        )
        data = validation
    elif role == "scheduling":
        request.update(
            validation_result_ref="validation:1",
            current_plan_ref="baseline:1",
            user_constraints=[],
            allowed_strategies=[{"strategy_id": "delay", "description": "顺延", "parameters": {}}],
            wip_policy=None,
            scheduling_tool_result=candidates,
        )
        data = candidates
    elif role == "evaluation":
        request.update(
            current_plan_ref="baseline:1",
            candidate_batch_id="BATCH-1",
            candidate_refs={"C1": "plan:C1", "C2": "plan:C2"},
            evaluation_criteria_ref=None,
            evaluation_tool_result=evaluation,
        )
        data = evaluation
    else:
        request.update(
            question="说明故障影响",
            validation_result_ref="validation:1",
            candidate_batch_ref=None,
            evaluation_result_ref=None,
            assumptions=[],
        )
        data = {
            "summary": "已完成当前数据校验。",
            "facts": [{"text": "工具已检查故障时间。", "evidence_refs": ["source:1"]}],
            "assumptions": [],
            "risks": [],
            "tradeoffs": [],
            "next_steps": [],
            "limitations": [],
        }
    return request, envelope(role, data)


def run(role, request, result):
    prompt = PromptLoader().load(role)
    typed = validate_request(json.dumps(request, ensure_ascii=False), prompt)
    return validate_result(json.dumps(result, ensure_ascii=False), typed, prompt)


@pytest.mark.parametrize("role", ["validation", "scheduling", "evaluation", "explanation"])
def test_valid_role_contracts_and_schema_generation(role):
    request, result = scenario(role)
    output = run(role, request, result)
    assert output.agent_name == role
    assert output.status == "success"
    assert type(output).model_json_schema()["additionalProperties"] is False


@pytest.mark.parametrize("role", ["validation", "scheduling", "evaluation", "explanation"])
def test_blocked_result_requires_diagnostics_but_not_a_fabricated_report(role):
    request, _ = scenario(role)
    result = envelope(role, None, "blocked")
    result.update(evidence_refs=[], errors=[notice()])
    assert run(role, request, result).status == "blocked"


@pytest.mark.parametrize(
    "raw",
    ["", "```json\n{}\n```", "[]", "{} {}", '{"status":"success","status":"failed"}', '{"x":NaN}'],
)
def test_rejects_invalid_or_ambiguous_json(raw):
    request, _ = scenario("explanation")
    prompt = PromptLoader().load("explanation")
    typed = validate_request(json.dumps(request), prompt)
    with pytest.raises(AgentContractError) as error:
        validate_result(raw, typed, prompt)
    assert error.value.code == "INVALID_JSON"


@pytest.mark.parametrize(
    "field,value,code",
    [
        ("agent_name", "evaluation", "OUTPUT_SCHEMA_INVALID"),
        ("unexpected", "secret", "OUTPUT_SCHEMA_INVALID"),
        ("prompt_version", "9.0.0", "PROMPT_VERSION_MISMATCH"),
        ("requirements_version", "V2.0", "PROMPT_VERSION_MISMATCH"),
        ("data", None, "EMPTY_OR_INVALID_REPORT"),
        ("evidence_refs", [], "EMPTY_OR_INVALID_REPORT"),
        ("evidence_refs", ["invented:1"], "UNKNOWN_REFERENCE"),
        ("warnings", [notice()], "STATUS_CONFLICT"),
        ("status", "warning", "STATUS_CONFLICT"),
        ("status", "failed", "STATUS_CONFLICT"),
    ],
)
def test_rejects_invalid_output_fields(field, value, code):
    request, result = scenario("explanation")
    result[field] = value
    with pytest.raises(AgentContractError) as error:
        run("explanation", request, result)
    assert error.value.code == code


@pytest.mark.parametrize(
    "field,value",
    [
        ("case_id", "another"),
        ("snapshot_id", "old"),
        ("event_version", 1),
        ("current_plan_version", "old"),
        ("input_fingerprint", "old"),
    ],
)
def test_all_context_fields_must_match(field, value):
    request, result = scenario("explanation")
    result["context"][field] = value
    with pytest.raises(AgentContractError, match="输入指纹"):
        run("explanation", request, result)


def test_stale_catalog_evidence_rejected_before_model_invocation():
    request, result = scenario("explanation")
    request["evidence_catalog"]["source:1"]["context"]["event_version"] = 1
    with pytest.raises(AgentContractError) as error:
        run("explanation", request, result)
    assert error.value.code == "STALE_EVIDENCE"


def test_unknown_nested_citation_rejected():
    request, result = scenario("explanation")
    result["data"]["facts"][0]["evidence_refs"] = ["invented"]
    with pytest.raises(AgentContractError) as error:
        run("explanation", request, result)
    assert error.value.code == "UNKNOWN_REFERENCE"


def test_uncited_fact_and_blank_summary_rejected():
    request, result = scenario("explanation")
    result["data"]["facts"][0]["evidence_refs"] = []
    result["data"]["summary"] = "   "
    with pytest.raises(AgentContractError) as error:
        run("explanation", request, result)
    assert error.value.code == "OUTPUT_SCHEMA_INVALID"


@pytest.mark.parametrize("role", ["validation", "scheduling", "evaluation"])
def test_model_cannot_change_tool_owned_results(role):
    request, result = scenario(role)
    result["data"] = copy.deepcopy(result["data"])
    if role == "validation":
        result["data"]["checked_items"].append("invented_check")
    elif role == "scheduling":
        result["data"]["candidates"][0]["plan_ref"] = "plan:C2"
    else:
        result["data"]["evaluations"][0]["metrics_ref"] = "metrics:C2"
    with pytest.raises(AgentContractError) as error:
        run(role, request, result)
    assert error.value.code == "TOOL_RESULT_MISMATCH"


def test_validation_cannot_authorize_with_blocking_issues():
    request, result = scenario("validation")
    result["data"]["issues"] = [
        {
            "code": "CONFLICT",
            "severity": "blocking",
            "message": "报工冲突",
            "impact": "无法生成",
            "repair_hint": "确认现场状态",
            "evidence_refs": ["source:1"],
        }
    ]
    with pytest.raises(AgentContractError) as error:
        run("validation", request, result)
    assert error.value.code == "STATUS_CONFLICT"


def test_scheduling_requires_valid_upstream_validation():
    request, result = scenario("scheduling")
    request["evidence_catalog"]["validation:1"]["content"]["status"] = "blocked"
    with pytest.raises(AgentContractError) as error:
        run("scheduling", request, result)
    assert error.value.code == "VALIDATION_REQUIRED"


def test_single_candidate_requires_warning_and_limitation():
    request, result = scenario("scheduling")
    result["data"]["candidates"].pop()
    with pytest.raises(AgentContractError) as error:
        run("scheduling", request, result)
    assert error.value.code == "STATUS_CONFLICT"
    result["status"] = "warning"
    result["warnings"] = [notice()]
    result["data"]["limitations"] = ["只有一个可行方案。"]
    assert run("scheduling", request, result).status == "warning"


def test_evaluation_cannot_skip_requested_candidate():
    request, result = scenario("evaluation")
    result["data"]["evaluations"].pop()
    with pytest.raises(AgentContractError) as error:
        run("evaluation", request, result)
    assert error.value.code == "CANDIDATE_MISMATCH"


def test_explanation_tradeoffs_require_evaluation():
    request, result = scenario("explanation")
    result["data"]["tradeoffs"] = [
        {"text": "方案一更快", "candidate_ids": ["C1", "C2"], "evidence_refs": ["source:1"]}
    ]
    with pytest.raises(AgentContractError) as error:
        run("explanation", request, result)
    assert error.value.code == "EVALUATION_REQUIRED"


def test_input_rejects_unknown_fields_and_naive_snapshot_time():
    request, _ = scenario("validation")
    request["case_data"]["report_snapshot_at"] = "2026-10-19T13:00:00"
    with pytest.raises(AgentContractError) as error:
        validate_request(json.dumps(request), PromptLoader().load("validation"))
    assert error.value.code == "INPUT_SCHEMA_INVALID"


@pytest.mark.parametrize("value", ["2", True, -1])
def test_event_version_is_strict_nonnegative_integer(value):
    with pytest.raises(ValidationError):
        AgentContext.model_validate({**CONTEXT, "event_version": value})


def test_error_does_not_echo_business_data():
    request, result = scenario("explanation")
    result["secret"] = "DO-NOT-ECHO"
    with pytest.raises(AgentContractError) as error:
        run("explanation", request, result)
    assert "DO-NOT-ECHO" not in str(error.value)


def test_wrong_role_input_cannot_be_used_with_prompt():
    request, result = scenario("explanation")
    typed = ExplanationInput.model_validate(request)
    with pytest.raises(AgentContractError) as error:
        validate_result(json.dumps(result), typed, PromptLoader().load("validation"))
    assert error.value.code == "ROLE_MISMATCH"


def test_upstream_result_must_be_structured_and_current():
    request, result = scenario("explanation")
    request["evidence_catalog"]["validation:1"]["content"] = "工具说通过了"
    with pytest.raises(AgentContractError) as error:
        run("explanation", request, result)
    assert error.value.code == "UPSTREAM_RESULT_INVALID"


def test_completed_explanation_can_describe_blocked_validation():
    request, result = scenario("explanation")
    upstream = request["evidence_catalog"]["validation:1"]["content"]
    upstream.update(status="blocked", data=None, errors=[notice()])
    result["data"]["summary"] = "校验被阻断，请补充数据。"
    assert run("explanation", request, result).status == "success"


def test_explanation_with_valid_evaluation_can_compare_known_candidates():
    request, result = scenario("explanation")
    _, evaluation = scenario("evaluation")
    request["evaluation_result_ref"] = "evaluation:1"
    request["evidence_catalog"]["evaluation:1"]["content"] = evaluation
    result["data"]["tradeoffs"] = [
        {
            "text": "比较这两个候选的指标。",
            "candidate_ids": ["C1", "C2"],
            "evidence_refs": ["evaluation:1"],
        }
    ]
    assert run("explanation", request, result).status == "success"
    result["data"]["tradeoffs"][0]["candidate_ids"] = ["invented"]
    with pytest.raises(AgentContractError) as error:
        run("explanation", request, result)
    assert error.value.code == "CANDIDATE_MISMATCH"


def test_warning_can_disclose_missing_evaluation_metric():
    request, result = scenario("evaluation")
    result["data"]["evaluations"][0]["missing_metrics"] = ["machine_load"]
    with pytest.raises(AgentContractError) as error:
        run("evaluation", request, result)
    assert error.value.code == "STATUS_CONFLICT"
    result.update(status="warning", warnings=[notice()])
    assert run("evaluation", request, result).status == "warning"


def test_failure_cannot_smuggle_usable_candidate_data():
    request, result = scenario("scheduling")
    result.update(status="failed", errors=[notice()])
    with pytest.raises(AgentContractError) as error:
        run("scheduling", request, result)
    assert error.value.code == "STATUS_CONFLICT"


def test_input_schema_is_strict_and_unknown_fields_are_rejected():
    request, _ = scenario("explanation")
    request["publish"] = True
    with pytest.raises(AgentContractError) as error:
        validate_request(json.dumps(request), PromptLoader().load("explanation"))
    assert error.value.code == "INPUT_SCHEMA_INVALID"


def test_freeform_json_parameters_are_not_interpreted_as_reference_schemas():
    request, result = scenario("scheduling")
    request["allowed_strategies"][0]["parameters"] = {"evidence_refs": 12, "other_ref": False}
    assert run("scheduling", request, result).status == "success"


def test_old_requirement_baseline_cannot_be_used_as_upstream_result():
    request, result = scenario("explanation")
    request["evidence_catalog"]["validation:1"]["content"]["requirements_version"] = "V1.0"
    with pytest.raises(AgentContractError) as error:
        run("explanation", request, result)
    assert error.value.code == "UPSTREAM_VERSION_MISMATCH"
