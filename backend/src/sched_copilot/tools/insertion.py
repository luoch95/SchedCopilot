"""Insertion tools for the existing four Agent roles; no persistence or publication."""

from datetime import datetime

from ..domain.errors import RuleViolation
from ..domain.insertion_workflow import evaluate_result, validate_result
from ..domain.scheduling import validate_schedule


def validate_request(request, snapshot):
    errors = validate_schedule(snapshot.baseline, snapshot.machines)
    if errors or request["quantity"] <= 0:
        raise RuleViolation("插单输入或正式计划校验失败")
    if datetime.fromisoformat(request["requested_due_at"]) <= datetime.fromisoformat(
        request["earliest_start_at"]
    ):
        raise RuleViolation("交期必须晚于最早开工时间")
    return {"baseline_version": snapshot.baseline.version, "input_valid": True}


def schedule_request(calculate, snapshot):
    result = calculate()
    validate_result(result, snapshot)
    return result


def evaluate_request(result, snapshot, request):
    return evaluate_result(result, snapshot, request)


def explain_request(result):
    summary = result["summary"]
    return dict(
        facts=[
            f"预计完成：{summary['estimated_completion_at']}",
            f"受影响原订单：{summary['affected_order_count']}；延期加重：{summary['newly_delayed_order_count']}",
        ],
        risks=(["插单无法满足要求交期"] if not summary["meets_due"] else [])
        + (["原订单延期加重，需领导确认取舍"] if summary["newly_delayed_order_count"] else [])
        + (
            ["变化包含原计划资源约束修正，不是插单净影响"]
            if result["baseline_resource_issues"]
            else []
        ),
        limitations=list(result["assumptions"]),
        next_steps=["领导审批后，由排产计划员复核发布；审批本身不修改正式计划"],
    )
