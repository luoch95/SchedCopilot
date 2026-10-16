from datetime import timedelta

from sched_copilot.agents import run_analysis
from sched_copilot.domain import MachineFailure
from sched_copilot.scenario import EVENT_TIME, demo_machines, demo_orders, demo_schedule


def test_offline_graph_joins_both_specialists_and_does_not_need_credentials(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    event = MachineFailure("M1", EVENT_TIME, EVENT_TIME + timedelta(hours=4), "test", EVENT_TIME)
    result = run_analysis(demo_schedule(), event, demo_machines(), demo_orders())
    assert set(result) == {"plan_report", "resource_report", "decision_report"}
    assert "O1002-OP1" in result["plan_report"]
    assert "M2" in result["resource_report"]
    assert "allow-transfer" in result["decision_report"]
    assert all("离线脚本演示" in report for report in result.values())


def test_live_graph_invokes_tools_with_fake_model_without_network():
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage, ToolMessage
    from langchain_core.outputs import ChatGeneration, ChatResult

    observed = []

    class ToolCallingModel(BaseChatModel):
        @property
        def _llm_type(self):
            return "test-tool-model"

        def bind_tools(self, tools, **kwargs):
            return self

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            if isinstance(messages[-1], ToolMessage):
                observed.append(messages[-1].content)
                message = AIMessage(content="基于 read_evidence 的测试说明；由员工决定。")
            else:
                message = AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": "evidence-call",
                            "name": "read_evidence",
                            "args": {},
                        }
                    ],
                )
            return ChatResult(generations=[ChatGeneration(message=message)])

    event = MachineFailure("M1", EVENT_TIME, EVENT_TIME + timedelta(hours=4), "test", EVENT_TIME)
    result = run_analysis(
        demo_schedule(), event, demo_machines(), demo_orders(), live=True, model=ToolCallingModel()
    )
    assert len(observed) == 3
    assert all("基于 read_evidence" in report for report in result.values())
