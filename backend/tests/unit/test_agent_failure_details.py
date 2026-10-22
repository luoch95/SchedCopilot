"""Business findings survive every Agent; system errors do not invent business causes."""

from dataclasses import replace
from datetime import timedelta

import pytest
from test_explanation_agent import from_check
from test_scheduling_agent import from_validation, validation_request

from sched_copilot.agents.contracts import EvaluationInput
from sched_copilot.agents.evaluation_agent import EvaluationAgent
from sched_copilot.agents.explanation_agent import ExplanationAgent
from sched_copilot.agents.scheduling_agent import SchedulingAgent
from sched_copilot.agents.validation_agent import ValidationAgent
from sched_copilot.domain.errors import RuleViolation
from sched_copilot.domain.models import MachineFailure
from sched_copilot.domain.production import ProductionResources
from sched_copilot.scenarios.demo import EVENT_TIME, demo_schedule


def request_for(role):
    initial = validation_request()
    if role == "validation":
        return initial
    if role == "explanation":
        return from_check(initial)
    request = from_validation(initial)
    if role == "scheduling":
        return request
    run = SchedulingAgent().run(request)
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


@pytest.mark.parametrize(
    "role,agent",
    [
        ("validation", ValidationAgent),
        ("scheduling", SchedulingAgent),
        ("evaluation", EvaluationAgent),
        ("explanation", ExplanationAgent),
    ],
)
@pytest.mark.parametrize("business", [True, False])
def test_agents_distinguish_business_findings_from_system_failures(role, agent, business):
    reason = "工序 O1005-OP2 在 M2 加工需 300 分钟，已登记班次不足。"

    def tool(*args, **kwargs):
        raise RuleViolation(reason) if business else RuntimeError("secret-provider-value")

    run = agent(tool=tool).run(request_for(role))
    assert run.result.status == ("blocked" if business else "failed")
    assert run.result.data is None
    notice = run.result.errors[0]
    if business:
        assert reason in notice.message
        assert "具体原因" in notice.repair_hint
    else:
        assert "系统异常" in notice.message
        assert "无法据此判断生产条件" in notice.repair_hint
    assert "secret-provider-value" not in run.result.model_dump_json()


def test_calendar_failure_names_operation_mold_machine_and_actual_times():
    op = replace(demo_schedule().operations[0], id="O1005-OP2", duration_minutes=300)
    resources = ProductionResources(
        source="test",
        shifts={
            "M2": ((EVENT_TIME.replace(hour=8), EVENT_TIME.replace(hour=0) + timedelta(days=1)),)
        },
        operation_molds={op.id: "MD-A05"},
        initial_molds={"M2": "MD-A05"},
        changeover_minutes=15,
    )
    with pytest.raises(RuleViolation) as caught:
        resources.place(
            op,
            "M2",
            EVENT_TIME.replace(hour=19, minute=45),
            {},
            MachineFailure("M2", EVENT_TIME, EVENT_TIME.replace(hour=15), "test", EVENT_TIME),
        )
    message = str(caught.value)
    for text in ["O1005-OP2", "MD-A05", "M2", "300", "19:45", "00:45", "00:00"]:
        assert text in message
