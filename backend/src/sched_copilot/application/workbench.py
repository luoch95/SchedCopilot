"""Orchestrate the scheduling workflow without HTTP or database implementation details."""

import logging
from datetime import datetime
from uuid import uuid4

from ..domain.errors import RuleViolation
from ..domain.impact import operation_changes, order_impacts
from ..domain.models import Machine, MachineFailure, Order, Schedule
from ..domain.scheduling import affected_operations, failure_issues, generate_candidates
from .contracts import (
    Analyze,
    CandidateComparison,
    Decide,
    SaveEvent,
    SimulationResult,
    SnapshotVersion,
    WorkbenchSnapshot,
)
from .errors import AnalysisUnavailable, InvalidInput, ResourceNotFound, SnapshotConflict
from .ports import Analyzer, DecisionRepository, WorkflowRunner

logger = logging.getLogger(__name__)


class WorkbenchService:
    def __init__(
        self,
        repository: DecisionRepository,
        machines: tuple[Machine, ...],
        orders: tuple[Order, ...],
        snapshot_time: datetime,
        example: MachineFailure,
        analyzer: Analyzer,
        workflow_runner: WorkflowRunner | None = None,
    ):
        self.repository = repository
        self.machines = machines
        self._orders = orders
        self.snapshot_time = snapshot_time
        self.example = example
        self.analyzer = analyzer
        self.workflow_runner = workflow_runner

    @property
    def orders(self):
        provider = getattr(self.repository, "published_orders", lambda: ())
        return self._orders + provider()

    def initialize(self) -> None:
        if self.repository.active_event() is None:
            try:
                self.repository.record_event(self.example, expected_revision=0)
            except RuleViolation:
                if self.repository.active_event() is None:
                    raise

    def checked_snapshot(self, version: SnapshotVersion, *, allow_cancelled=False):
        baseline, event, revision = self.repository.snapshot()
        if version != SnapshotVersion(revision, baseline.fingerprint):
            raise SnapshotConflict("事件或计划已更新，请重新载入后操作")
        if not allow_cancelled and self.repository.event_cancelled(revision):
            raise InvalidInput("故障已撤销，请先录入新的故障")
        return baseline, event, revision

    def workbench(self) -> WorkbenchSnapshot:
        baseline, event, revision = self.repository.snapshot()
        cancelled = self.repository.event_cancelled(revision)
        return WorkbenchSnapshot(
            baseline,
            event,
            revision,
            self.snapshot_time,
            self.machines,
            self.orders,
            () if cancelled else tuple(op.id for op in affected_operations(baseline, event)),
            () if cancelled else failure_issues(baseline, event, self.machines),
            self.repository.history(),
            self.repository.plan_metadata(baseline.version, revision),
            self.repository.operation_labels(baseline),
            self.repository.event_history(),
            self.repository.fault_review(revision, baseline.fingerprint),
            cancelled,
        )

    def cancel_event(
        self, version: SnapshotVersion, target_revision: int | None = None
    ) -> WorkbenchSnapshot:
        self.checked_snapshot(version, allow_cancelled=True)
        self.repository.cancel_event(
            version.event_revision, version.baseline_fingerprint, target_revision
        )
        invalidate = getattr(self.workflow_runner, "invalidate_sessions", None)
        if invalidate:
            invalidate()
        return self.workbench()

    def save_event(self, command: SaveEvent) -> WorkbenchSnapshot:
        self.checked_snapshot(command.version, allow_cancelled=True)
        if command.machine_id not in {machine.id for machine in self.machines}:
            raise InvalidInput("故障设备不存在")
        event = MachineFailure(
            command.machine_id,
            command.started_at,
            command.recovered_at,
            command.source.strip(),
            max(self.snapshot_time, command.started_at),
        )
        self.repository.record_event(event, expected_revision=command.version.event_revision)
        return self.workbench()

    def _choose_recovery(
        self, baseline: Schedule, history: tuple[MachineFailure, ...]
    ) -> MachineFailure:
        deleted = getattr(self.repository, "has_deleted_events", lambda: False)()
        example_cancelled = any(
            item.get("cancelled")
            and item["machine_id"] == self.example.machine_id
            and datetime.fromisoformat(item["started_at"]) == self.example.started_at
            for item in self.repository.event_history()
        )
        examples = () if deleted or example_cancelled else (self.example,)
        for event in (*history, *examples):
            try:
                generate_candidates(baseline, event, self.machines, self.orders)
            except RuleViolation:
                continue
            return event
        raise RuleViolation("当前执行记录没有可恢复的试算事件，请检查计划数据")

    def recover_event(self, version: SnapshotVersion) -> WorkbenchSnapshot:
        self.checked_snapshot(version)
        self.repository.recover_event(
            self._choose_recovery, expected_revision=version.event_revision
        )
        return self.workbench()

    def simulate(self, version: SnapshotVersion) -> SimulationResult:
        baseline, event, revision = self.checked_snapshot(version)
        candidates = generate_candidates(
            baseline,
            event,
            self.machines,
            self.orders,
            event_revision=revision,
            additional_failures=tuple(f for f in self.repository.failure_windows() if f != event),
        )
        simulation_id = str(uuid4())
        self.repository.record_simulation(simulation_id, candidates, event)
        return SimulationResult(
            simulation_id,
            SnapshotVersion(revision, baseline.fingerprint),
            tuple(
                CandidateComparison(
                    candidate,
                    operation_changes(baseline, candidate, event),
                    order_impacts(baseline, candidate, self.orders),
                )
                for candidate in candidates
            ),
            self.repository.operation_labels(baseline),
        )

    def submit_fault_review(self, simulation_id, candidate_id, reason, request_id):
        self.manual_faults.check_simulation(simulation_id)
        self.repository.submit_fault_review(simulation_id, candidate_id, reason, request_id)
        return self.workbench()

    def review_fault(self, review_id, action, reason):
        baseline, _, revision = self.repository.snapshot()
        current = self.repository.fault_review(revision, baseline.fingerprint)
        if current and current["id"] == review_id:
            self.manual_faults.check_simulation(current["simulation_id"])
        if current and current["id"] == review_id and current.get("kind") == "assessment":
            latest = self.latest_workflow()
            if not latest or latest[0]["id"] != current["workflow_id"]:
                raise SnapshotConflict("评估数据已更新，请重新生成并提交审批")
        self.repository.review_fault(review_id, action, reason)
        return self.workbench()

    def submit_assessment_review(self, workflow_id, reason, request_id):
        latest = self.latest_workflow()
        if not latest or latest[0]["id"] != workflow_id:
            raise SnapshotConflict("评估数据已更新，请重新生成并提交审批")
        self.repository.submit_assessment_review(workflow_id, reason, request_id)
        return self.workbench()

    def decide(self, command: Decide) -> tuple[int, WorkbenchSnapshot]:
        row = self.repository.simulation(command.simulation_id)
        if row is None:
            raise ResourceNotFound("候选批次不存在，请重新生成方案")
        candidates, event = row
        candidate = next((item for item in candidates if item.id == command.candidate_id), None)
        if candidate is None:
            raise ResourceNotFound("该批次没有此候选方案")
        if command.action == "publish" and candidate.metrics.moved_operations == 0:
            raise RuleViolation("该候选与当前计划相同，无需重复发布")
        self.manual_faults.check_simulation(command.simulation_id)
        result = self.repository.decide(
            candidate,
            event,
            self.machines,
            command.action,
            command.reason,
            command.request_id,
            approval_simulation_id=command.simulation_id,
        )
        logger.info(
            "Human decision recorded: action=%s plan_version=%s", command.action, result.version
        )
        return result.version, self.workbench()

    def run_workflow(
        self,
        version: SnapshotVersion,
        *,
        intent: str,
        question: str,
        workflow_id: str | None = None,
        on_progress=None,
        demo_fallback=False,
    ) -> tuple[dict, SimulationResult | None]:
        baseline, event, revision = self.checked_snapshot(version)
        if self.workflow_runner is None:
            raise InvalidInput("动态编排器未配置")
        outcome = self.workflow_runner(
            baseline,
            event,
            self.machines,
            self.orders,
            self.snapshot_time,
            revision,
            intent=intent,
            question=question,
            workflow_id=workflow_id,
            **({"on_progress": on_progress} if on_progress else {}),
            **({"demo_fallback": True} if demo_fallback else {}),
        )
        self.checked_snapshot(version)
        simulation = None
        if outcome.candidates:
            simulation_id = str(uuid4())
            self.repository.record_simulation(simulation_id, outcome.candidates, event)
            simulation = SimulationResult(
                simulation_id,
                version,
                tuple(
                    CandidateComparison(
                        c,
                        operation_changes(baseline, c, event),
                        order_impacts(baseline, c, self.orders),
                    )
                    for c in outcome.candidates
                ),
                self.repository.operation_labels(baseline),
            )
        simulation_id = simulation.id if simulation else None
        if not simulation_id and workflow_id and intent in {"explain", "re_evaluate"}:
            simulation_id = self.repository.workflow_simulation_id(workflow_id)
        self.repository.attach_workflow_simulation(outcome.payload["id"], simulation_id)
        return outcome.payload, simulation

    def fault_analysis(self, revision: int) -> dict | None:
        return self.repository.fault_analysis(revision)

    def latest_workflow(self) -> tuple[dict, SimulationResult | None] | None:
        saved = self.repository.latest_workflow()
        if saved is None:
            return None
        payload, simulation_id = saved
        baseline, event, revision = self.repository.snapshot()
        if self.repository.event_cancelled(revision):
            return None
        if not self.workflow_runner.matches_snapshot(
            payload, baseline, event, self.machines, self.orders, self.snapshot_time, revision
        ):
            return None
        simulation = None
        saved_simulation = self.repository.simulation(simulation_id) if simulation_id else None
        if saved_simulation:
            candidates, saved_event = saved_simulation
            simulation = SimulationResult(
                simulation_id,
                SnapshotVersion(revision, baseline.fingerprint),
                tuple(
                    CandidateComparison(
                        c,
                        operation_changes(baseline, c, saved_event),
                        order_impacts(baseline, c, self.orders),
                    )
                    for c in candidates
                ),
                self.repository.operation_labels(baseline),
            )
        return payload, simulation

    def analyze(self, command: Analyze) -> dict:
        baseline, event, _ = self.checked_snapshot(command.version)
        # Separate invalid scheduling inputs from provider/configuration failures.
        generate_candidates(baseline, event, self.machines, self.orders)
        try:
            reports = self.analyzer(
                baseline,
                event,
                self.machines,
                self.orders,
                live=command.live,
                question=command.question,
            )
        except Exception as exc:
            # Do not log provider errors, credentials, prompts or response contents.
            logger.warning("Agent analysis failed: %s", type(exc).__name__)
            raise AnalysisUnavailable("分析未完成，请检查模型配置和连接；排程仍可使用") from exc
        self.checked_snapshot(command.version)
        return {"reports": reports, "mode": "live" if command.live else "offline"}
