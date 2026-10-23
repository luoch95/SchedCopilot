"""Bounded execution/check/repair loop owned by each role Agent."""

from collections.abc import Callable
from contextlib import contextmanager
from contextvars import ContextVar
from time import monotonic
from typing import TypeVar

from ..domain.errors import RuleViolation
from .contracts.common import Notice, QualityIssue, QualityReport, QualityRound
from .result_validation import AgentContractError

T = TypeVar("T")
MAX_QUALITY_ROUNDS = 3
QUALITY_BUDGET_SECONDS = 120
_progress: ContextVar[Callable[[dict], None] | None] = ContextVar("quality_progress", default=None)


@contextmanager
def quality_progress(callback):
    token = _progress.set(callback)
    try:
        yield
    finally:
        _progress.reset(token)


def _emit(event):
    callback = _progress.get()
    if callback:
        callback(event)


class QualityFailure(ValueError):
    def __init__(self, report: QualityReport):
        self.report = report
        super().__init__("Agent output did not pass quality checks")


def failure_status(exc):
    if (
        isinstance(exc, QualityFailure)
        and exc.report.issues
        and all(
            issue.code == "BUSINESS_RULE_VIOLATION" or issue.repairable
            for issue in exc.report.issues
        )
    ):
        return "blocked"
    return "failed"


def failure_notice(exc, role: str, code: str) -> Notice:
    """Expose checked business/quality findings, never arbitrary exception bodies."""
    labels = {
        "validation": "数据校验",
        "scheduling": "排产",
        "evaluation": "方案评估",
        "explanation": "结果解释",
    }
    details = ""
    if isinstance(exc, QualityFailure):
        details = "；".join(dict.fromkeys(issue.message for issue in exc.report.issues))
    return Notice(
        code=code,
        message=f"本次{labels[role]}未交付可用结果。"
        + (details or "工具执行发生系统异常，具体业务原因尚未确认。"),
        repair_hint=(
            "请根据上述具体原因处理后重新执行；后续依赖环节尚未完成。"
            if failure_status(exc) == "blocked"
            else "请联系维护人员根据本次执行记录排查；本次未获得可用结果，"
            "无法据此判断生产条件是否满足。"
        ),
        evidence_refs=[],
    )


def checked_execute(
    execute: Callable[[], T],
    check: Callable[[T], None],
    repair: Callable[[T, tuple[QualityIssue, ...]], T],
    *,
    repair_label: str,
    check_code: str = "QUALITY_OUTPUT_INVALID",
    check_message: str = "输出未通过事实、约束或证据一致性检查。",
    max_rounds: int = MAX_QUALITY_ROUNDS,
    budget_seconds: float = QUALITY_BUDGET_SECONDS,
    clock: Callable[[], float] = monotonic,
    blocked: tuple[type[Exception], ...] = (),
) -> tuple[T, QualityReport]:
    """Repair rejected output from immutable inputs, never retry tool crashes.

    Deadline is checked between synchronous calls. Late output is discarded;
    this runner cannot preempt a synchronous tool that never returns.
    """
    if not 1 <= max_rounds <= MAX_QUALITY_ROUNDS or budget_seconds <= 0:
        raise ValueError("Invalid quality loop budget")
    started, history, seen = clock(), [], set()
    output, issues = None, ()

    def fail(reason, current_issues):
        raise QualityFailure(
            QualityReport(
                outcome="failed",
                round=len(history) or 1,
                issues=list(current_issues),
                stop_reason=reason,
                history=history,
            )
        )

    for number in range(1, max_rounds + 1):
        repair_name = repair_label if number > 1 else None
        _emit(
            {
                "type": "quality_phase",
                "phase": "repairing" if repair_name else "executing",
                "round": number,
            }
        )
        try:
            output = execute() if number == 1 else repair(output, issues)
        except blocked as exc:
            issue = QualityIssue(code=exc.notice.code, message=exc.notice.message, repairable=False)
            history.append(QualityRound(round=number, issues=[issue], repair=repair_name))
            exc.quality_report = QualityReport(
                outcome="blocked",
                round=number,
                issues=[issue],
                stop_reason="业务条件阻断",
                history=history,
            )
            raise
        except RuleViolation as exc:
            issue = QualityIssue(code="BUSINESS_RULE_VIOLATION", message=str(exc), repairable=False)
            history.append(QualityRound(round=number, issues=[issue], repair=repair_name))
            fail("业务条件不满足", [issue])
        except Exception:
            issue = QualityIssue(
                code="QUALITY_TOOL_EXCEPTION",
                message="工具执行发生系统异常，具体业务原因尚未确认，本次不自动重试。",
                repairable=False,
            )
            history.append(QualityRound(round=number, issues=[issue], repair=repair_name))
            fail("工具异常", [issue])
        if clock() - started >= budget_seconds:
            issue = QualityIssue(
                code="QUALITY_TIME_LIMIT",
                message="质量检查超过总时限，结果不交付。",
                repairable=False,
            )
            history.append(QualityRound(round=number, issues=[issue], repair=repair_name))
            fail("达到总时限", [issue])
        _emit({"type": "quality_phase", "phase": "checking", "round": number})
        try:
            check(output)
            issues = ()
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            code = exc.code if isinstance(exc, AgentContractError) else check_code
            fatal = code in {
                "STALE_CONTEXT",
                "STALE_EVIDENCE",
                "EVIDENCE_COLLISION",
                "TOOL_INPUT_MISMATCH",
            }
            issues = (
                QualityIssue(
                    code=code,
                    message=check_message,
                    repairable=not fatal,
                ),
            )
        except Exception:
            issues = (
                QualityIssue(
                    code="QUALITY_CHECK_EXCEPTION",
                    message="质量检查工具异常，停止交付。",
                    repairable=False,
                ),
            )
        history.append(QualityRound(round=number, issues=list(issues), repair=repair_name))
        if clock() - started >= budget_seconds:
            issue = QualityIssue(
                code="QUALITY_TIME_LIMIT",
                message="检查耗时超过总时限，结果不交付。",
                repairable=False,
            )
            history[-1] = history[-1].model_copy(update={"issues": [*issues, issue]})
            fail("达到总时限", [*issues, issue])
        _emit(
            {
                "type": "quality_checked",
                "round": number,
                "outcome": "failed" if issues else "passed",
                "issues": [i.model_dump(mode="json") for i in issues],
            }
        )
        if not issues:
            return output, QualityReport(
                outcome="passed", round=number, history=history, stop_reason="检查通过"
            )
        if any(not issue.repairable for issue in issues):
            fail("问题不可自动修正", issues)
        fingerprint = repr(output)
        if fingerprint in seen:
            fail("重复输出，无改善", issues)
        seen.add(fingerprint)
        if number == max_rounds:
            fail("达到轮次上限", issues)
    raise AssertionError("Unreachable")


def finish_quality(result, quality):
    outcome = {"success": "passed", "warning": "warning", "blocked": "blocked", "failed": "failed"}[
        result.status
    ]
    if quality is None:
        quality = QualityReport(
            outcome=outcome,
            round=1,
            stop_reason="输入条件不满足" if outcome == "blocked" else "执行未完成",
        )
    elif quality.outcome == "passed" and outcome == "blocked":
        quality = quality.model_copy(update={"stop_reason": "输出检查通过，业务数据存在阻断项"})
    return result.model_copy(update={"quality": quality.model_copy(update={"outcome": outcome})})


def verify_evidence(output, request):
    for ref, evidence in output.evidence_catalog.items():
        if evidence.context != request.context:
            raise AgentContractError("STALE_EVIDENCE", "工具返回其他版本证据。")
        if ref in request.evidence_catalog and request.evidence_catalog[ref] != evidence:
            raise AgentContractError("EVIDENCE_COLLISION", "工具证据与输入冲突。")
    if not output.summary_refs or set(output.summary_refs) - (
        output.evidence_catalog.keys() | request.evidence_catalog.keys()
    ):
        raise ValueError("工具缺少结果证据")


def validate_handoff(run, role):
    from ..prompts import PromptLoader
    from .result_validation import validate_result

    result = validate_result(run.result.model_dump_json(), run.request, PromptLoader().load(role))
    if result.quality is None:
        raise AgentContractError("QUALITY_REPORT_REQUIRED", "Agent 未提供质量检查记录，停止交付。")
    return result
