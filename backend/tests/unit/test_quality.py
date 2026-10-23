"""Quality loop boundaries and repair feedback, without external models."""

import pytest

from sched_copilot.agents.quality import QualityFailure, checked_execute, quality_progress
from sched_copilot.agents.result_validation import AgentContractError


def reject(value):
    raise ValueError("invalid output")


def test_repair_receives_rejected_output_and_check_issues():
    events, feedback = [], []

    def check(value):
        if value != "fixed":
            reject(value)

    def repair(value, issues):
        feedback.append((value, issues))
        return "fixed"

    with quality_progress(events.append):
        output, quality = checked_execute(lambda: "bad", check, repair, repair_label="rebuild")
    assert output == "fixed"
    assert quality.outcome == "passed"
    assert quality.round == 2
    assert feedback[0][0] == "bad"
    assert feedback[0][1][0].repairable
    assert [h.round for h in quality.history] == [1, 2]
    assert quality.history[1].repair == "rebuild"
    assert [e["phase"] for e in events if e["type"] == "quality_phase"] == [
        "executing",
        "checking",
        "repairing",
        "checking",
    ]


@pytest.mark.parametrize(
    "mode, rounds, reason", [("repeat", 2, "重复输出，无改善"), ("limit", 3, "达到轮次上限")]
)
def test_failed_repairs_stop(mode, rounds, reason):
    with pytest.raises(QualityFailure) as caught:
        checked_execute(
            lambda: 0,
            reject,
            lambda value, issues: value if mode == "repeat" else value + 1,
            repair_label="repair",
        )
    assert caught.value.report.round == rounds
    assert caught.value.report.stop_reason == reason
    assert caught.value.report.outcome == "failed"


def test_stale_evidence_is_not_repaired():
    def check(value):
        raise AgentContractError("STALE_EVIDENCE", "old snapshot")

    def forbidden(*args):
        pytest.fail("Must not repair stale inputs")

    with pytest.raises(QualityFailure) as caught:
        checked_execute(lambda: 0, check, forbidden, repair_label="repair")
    assert caught.value.report.round == 1
    assert not caught.value.report.issues[0].repairable


def test_tool_crash_never_retries_or_leaks_exception():
    calls = []

    def crash():
        calls.append(1)
        raise RuntimeError("secret-provider-value")

    with pytest.raises(QualityFailure) as caught:
        checked_execute(
            crash, reject, lambda *args: pytest.fail("Unexpected repair"), repair_label="repair"
        )
    assert len(calls) == 1
    assert caught.value.report.issues[0].code == "QUALITY_TOOL_EXCEPTION"
    assert "secret-provider-value" not in caught.value.report.model_dump_json()


@pytest.mark.parametrize("ticks", [(0, 121), (0, 0, 121)])
def test_late_tool_or_check_result_is_not_delivered(ticks):
    timer = iter(ticks)
    with pytest.raises(QualityFailure) as caught:
        checked_execute(
            lambda: 0,
            lambda value: None,
            lambda *args: 0,
            repair_label="repair",
            clock=lambda: next(timer),
        )
    assert caught.value.report.issues[-1].code == "QUALITY_TIME_LIMIT"


def test_progress_context_is_reset_after_failure():
    events = []
    with pytest.raises(QualityFailure), quality_progress(events.append):
        checked_execute(lambda: 0, reject, lambda *args: 0, repair_label="repair")
    before = len(events)
    checked_execute(lambda: 0, lambda value: None, lambda *args: 0, repair_label="repair")
    assert len(events) == before
