"""Insertion submission use case; storage is provided through an application port."""

import json
from datetime import datetime, timezone
from hashlib import sha256

from ..domain.errors import RuleViolation
from ..domain.insertion import trial_insertion
from ..domain.insertion_workflow import (
    label_request_operations,
    publication_resources,
    validate_result,
)
from ..domain.models import digest
from .errors import ResourceNotFound
from .ports import InsertionRepository
from .sales import SalesService


class SalesRequestService:
    def __init__(
        self,
        repository: InsertionRepository,
        sales_service: SalesService,
        routes=None,
        resources_factory=None,
        workflow_runner=None,
    ):
        self.repository = repository
        self.sales_service = sales_service
        self.routes = routes or {}
        self.resources_factory = resources_factory
        self.workflow_runner = workflow_runner

    def submit(
        self,
        *,
        product_id: str,
        quantity: int,
        earliest_start_at: datetime,
        requested_due_at: datetime,
        reason: str,
        submission_key: str,
        plan_version: int,
        plan_fingerprint: str,
        snapshot_time: datetime,
        applicant_session_id: str | None = None,
    ):
        if not reason.strip() or requested_due_at <= earliest_start_at:
            raise RuleViolation("请填写有效的紧急原因和交期")
        estimate = self.sales_service.estimate(product_id, quantity)
        values = dict(
            product_id=product_id,
            quantity=quantity,
            earliest_start_at=earliest_start_at,
            requested_due_at=requested_due_at,
            reason=reason.strip(),
            applicant_session_id=applicant_session_id,
        )
        # Fingerprint only submitted business input; a retry may occur after plan changes.
        signature = dict(values)
        for field in ("earliest_start_at", "requested_due_at"):
            signature[field] = values[field].astimezone(timezone.utc).isoformat()
        fingerprint = sha256(json.dumps(signature, sort_keys=True).encode()).hexdigest()
        existing = self.repository.submission(submission_key, fingerprint)
        if existing is not None:
            return existing
        if earliest_start_at < snapshot_time:
            raise RuleViolation("最早开工时间不能早于当前演示快照")
        # Demo line assignment is server-owned and excluded from the input fingerprint.
        values["assigned_planner"] = "planner_01"
        return self.repository.submit(
            values, submission_key, fingerprint, estimate, plan_version, plan_fingerprint
        )

    def pending(
        self,
        snapshot=None,
        production_snapshot=None,
        status="pending_approval",
        assigned_planner=None,
    ):
        records = self.repository.records(None if status == "all" else status, assigned_planner)
        if snapshot is not None:
            for record in records:
                result = record.get("assessment")
                record["assessment_stale"] = bool(
                    result
                    and record["status"] != "published"
                    and (
                        result["baseline_fingerprint"] != snapshot.baseline.fingerprint
                        or result["event_revision"] != snapshot.event_revision
                        or result.get("production_inputs_fingerprint")
                        != self.production_fingerprint(production_snapshot)
                    )
                )
        return records

    @staticmethod
    def production_fingerprint(snapshot):
        return sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

    def assess(self, request_id, snapshot, production_snapshot=None):
        request = self.repository.get(request_id)
        if request is None:
            raise ResourceNotFound("插单申请不存在")
        if request["status"] in {"rejected", "published"}:
            raise RuleViolation("已驳回或已发布申请不能重新试排，请新建申请")
        if self.workflow_runner:
            result = self.workflow_runner(
                request, snapshot, lambda: self._calculate(request, snapshot, production_snapshot)
            )
        else:
            result = self._calculate(request, snapshot, production_snapshot)
        result["request_no"] = request["request_no"]
        self.repository.save_assessment(request["id"], result)
        return result

    def detail(self, request_no, snapshot, production_snapshot=None):
        record = self.repository.get(request_no)
        if record is None:
            raise ResourceNotFound("插单申请不存在")
        result = record.get("assessment")
        record["assessment_stale"] = bool(
            result
            and record["status"] != "published"
            and (
                result["baseline_fingerprint"] != snapshot.baseline.fingerprint
                or result["event_revision"] != snapshot.event_revision
                or result.get("production_inputs_fingerprint")
                != self.production_fingerprint(production_snapshot)
            )
        )
        return record

    def _calculate(self, request, snapshot, production_snapshot):
        request_id = request["id"]
        steps = self.routes.get(request["product_id"])
        if not steps:
            raise RuleViolation("模拟产品缺少工艺路线")
        estimate = request["estimate"]
        resources = self.resources_factory(
            snapshot.baseline, request_id, steps, production_snapshot
        )
        result = trial_insertion(
            snapshot.baseline,
            snapshot.machines,
            snapshot.orders,
            request_id,
            datetime.fromisoformat(request["requested_due_at"]),
            datetime.fromisoformat(request["earliest_start_at"]),
            snapshot.snapshot_time,
            estimate["planned_minutes"],
            steps,
            resources,
            None if snapshot.event_cancelled else snapshot.event,
        )
        result["details"]["processing_estimate"] = estimate
        result["details"]["resource_snapshot"] = dict(
            source=resources.source,
            changeover_minutes=resources.setup_minutes,
            operation_molds=resources.operation_molds,
            mold_machines=resources.mold_machines,
            initial_molds=resources.initial_molds,
            shifts={
                m: [[a.isoformat(), b.isoformat()] for a, b in windows]
                for m, windows in resources.shifts.items()
            },
        )
        result["details"]["route_snapshot"] = [
            dict(
                sequence=s.sequence,
                name=s.name,
                capability=s.capability,
                mold_id=s.mold_id,
                eligible_machine_ids=list(s.machine_ids),
                fixed_minutes=s.fixed_minutes,
            )
            for s in steps
        ]
        result["resources_fingerprint"] = digest(resources)
        result["production_inputs_fingerprint"] = self.production_fingerprint(production_snapshot)
        result.update(
            request_id=request_id,
            baseline_version=snapshot.baseline.version,
            baseline_fingerprint=snapshot.baseline.fingerprint,
            event_revision=snapshot.event_revision,
            tool_version="insertion-rule-v1",
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        return label_request_operations(result, request["request_no"], snapshot.operation_labels)

    def act(
        self,
        request_id,
        action,
        reason,
        assessment_id,
        operator_role,
        snapshot,
        production_snapshot=None,
    ):
        required = "planner" if action == "publish" else "leader"
        if operator_role != required:
            raise RuleViolation("当前演示角色不能执行此操作")
        if not reason.strip():
            raise RuleViolation("请填写审批或复核理由")
        request = self.repository.get(request_id)
        if request is None:
            raise ResourceNotFound("插单申请不存在")
        schedule = production = None
        if action == "publish" and request["status"] != "published":
            result = request["assessment"]
            if result is None or request["status"] != "approved":
                raise RuleViolation("仅已批准且完成试排的申请可复核发布")
            if (
                result["baseline_fingerprint"] != snapshot.baseline.fingerprint
                or result["event_revision"] != snapshot.event_revision
                or result["production_inputs_fingerprint"]
                != self.production_fingerprint(production_snapshot)
            ):
                raise RuleViolation("计划、事件或生产资源已变化，请重新试排并审批")
            fresh = self._calculate(request, snapshot, production_snapshot)
            if (
                json.dumps(fresh["details"], sort_keys=True)
                != json.dumps(result["details"], sort_keys=True)
                or fresh["summary"] != result["summary"]
            ):
                raise RuleViolation("试排依据已变化，请重新试排并审批")
            schedule = validate_result(result, snapshot)
            production = publication_resources(result, production_snapshot)
        return self.repository.transition(
            request["id"], action, reason.strip(), assessment_id, schedule, production
        )
