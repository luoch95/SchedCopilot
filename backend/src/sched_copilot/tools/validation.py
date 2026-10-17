"""Adapt the Agent snapshot contract to the framework-free validation rules."""

import hashlib
import json
from dataclasses import dataclass

from ..agents.contracts.common import AgentContext, Evidence
from ..agents.contracts.inputs import SchedulingCase
from ..agents.contracts.results import ValidationData, ValidationIssue
from ..domain.models import Machine, Operation, Order, Schedule, TaskStatus
from ..domain.validation import (
    FailureRecord,
    MoldCompatibility,
    ValidationCase,
    validate_case,
)

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
    domain_case = ValidationCase(
        schedule=Schedule(
            0,
            tuple(
                Operation(
                    op.operation_id,
                    op.order_id,
                    op.sequence,
                    op.capability,
                    op.machine_id,
                    op.duration_minutes,
                    op.start_at,
                    TaskStatus(op.status),
                )
                for op in case.operations
            ),
        ),
        machines=tuple(
            Machine(m.machine_id, m.machine_id, frozenset(m.capabilities)) for m in case.machines
        ),
        orders=tuple(Order(o.order_id, o.order_id, o.due_at, o.priority) for o in case.orders),
        failures=tuple(
            FailureRecord(
                f.event_id, f.machine_id, f.started_at, f.estimated_recovery_at, f.received_at
            )
            for f in case.failures
        ),
        molds=tuple(
            MoldCompatibility(m.mold_id, tuple(m.compatible_machine_ids)) for m in case.molds
        ),
        operation_molds=tuple(op.mold_id for op in case.operations),
        unavailable_machine_ids=frozenset(m.machine_id for m in case.machines if not m.available),
        report_snapshot_at=case.report_snapshot_at,
        wip_policy=case.wip_policy,
    )
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
