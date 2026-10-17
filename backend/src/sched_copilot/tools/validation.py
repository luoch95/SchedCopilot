"""Adapt the Agent snapshot contract to the framework-free validation rules."""

import hashlib
import json
from dataclasses import dataclass

from ..agents.contracts.common import AgentContext, Evidence
from ..agents.contracts.inputs import SchedulingCase
from ..agents.contracts.results import ValidationData, ValidationIssue
from ..domain.validation import validate_case
from .case_mapping import to_validation_case

RULESET_VERSION = "1.0.0"


@dataclass(frozen=True)
class ValidationToolOutput:
    data: ValidationData
    evidence_catalog: dict[str, Evidence]
    summary_refs: tuple[str, ...]


def validate_data(case: SchedulingCase, context: AgentContext) -> ValidationToolOutput:
    """Read only; never trust a previously supplied validation report."""
    raw = case.model_dump(mode="json")
    fingerprint = hashlib.sha256(
        json.dumps(
            {"case": raw, "context": context.model_dump(mode="json"), "rules": RULESET_VERSION},
            sort_keys=True,
            ensure_ascii=False,
        ).encode("utf-8")
    ).hexdigest()
    prefix = f"validation-input:{fingerprint}"
    records = {"case": raw, "rules": {"ruleset_version": RULESET_VERSION}}
    for name, field in (
        ("operation", "operations"),
        ("order", "orders"),
        ("machine", "machines"),
        ("mold", "molds"),
        ("event", "failures"),
    ):
        records.update({f"{name}:{i}": record for i, record in enumerate(raw[field])})
    evidence = {
        f"{prefix}:{key}": Evidence(context=context.model_copy(deep=True), kind=key, content=value)
        for key, value in records.items()
    }
    domain_case = to_validation_case(case)
    report = validate_case(domain_case)
    issues = [
        ValidationIssue(
            code=issue.code,
            severity=issue.severity,
            message=issue.message,
            impact=issue.impact,
            repair_hint=issue.repair_hint,
            evidence_refs=[f"{prefix}:{ref}" for ref in issue.references],
        )
        for issue in report.issues
    ]
    return ValidationToolOutput(
        data=ValidationData(
            can_generate_candidates=not any(i.severity == "blocking" for i in issues),
            checked_items=list(report.checked_items),
            unchecked_items=list(report.unchecked_items),
            issues=issues,
        ),
        evidence_catalog=evidence,
        summary_refs=(f"{prefix}:case", f"{prefix}:rules"),
    )
