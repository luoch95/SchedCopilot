"""Deterministic report quality scores, never feasibility or success probabilities."""

from .assessment import is_business_conclusion
from .results import ValidationResult

VALIDATION_THRESHOLD = 98.0
FATAL_DATA_CODES = frozenset(
    {
        "MISSING_DATA",
        "FAILURE_MACHINE_NOT_FOUND",
        "ORDER_NOT_FOUND",
        "MOLD_NOT_FOUND",
        "MOLD_MACHINE_UNKNOWN",
    }
)


def validation_status(data):
    blocking = [i for i in data.issues if i.severity == "blocking"]
    if any(i.code in FATAL_DATA_CODES for i in blocking):
        return "failed"
    if blocking:
        return "blocked"
    return "warning" if any(i.severity == "warning" for i in data.issues) else "success"


def score_result(result, quality, request):
    reasons = []
    conclusion = is_business_conclusion(result)
    if result.status in {"failed", "blocked"} and not conclusion:
        score = 0.0
        reasons.append("未交付通过校验的结果，不允许依赖此结果继续生成。")
    elif result.agent_name == "validation":
        score = 98.0 if result.warnings else 100.0
        reasons.append("必需数据与硬约束检查通过；轻微警告扣 2 分，未检查项不算通过项。")
    else:
        score = 100.0 - 5.0 * (quality.round - 1)
        reasons.append(f"事实与证据检查通过；每次受控修正扣 5 分，本次 {quality.round - 1} 次。")
        if result.warnings or conclusion:
            score = min(score, 95.0)
            reasons.append("保留业务警告或无候选结论，得分上限 95%。")
        validation = None
        ref = getattr(request, "validation_result_ref", None)
        records = (
            [request.evidence_catalog[ref]]
            if ref
            else [e for e in request.evidence_catalog.values() if e.kind == "validation_result"]
        )
        for evidence in records:
            candidate = ValidationResult.model_validate(evidence.content)
            if candidate.context == result.context:
                validation = candidate
        if (
            validation
            and validation.data
            and (validation.warnings or validation.data.unchecked_items)
        ):
            score = min(score, 70.0)
            reasons.append("上游存在数据警告或未核验生产条件，得分上限 70%。")
    return dict(score=score, score_version="rules-v1", score_reasons=reasons)
