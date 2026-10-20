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

    def checked_snapshot(self, version: SnapshotVersion):
        baseline, event, revision = self.repository.snapshot()
        if version != SnapshotVersion(revision, baseline.fingerprint):
            raise SnapshotConflict("事件或计划已更新，请重新载入后操作")
        return baseline, event, revision

    def workbench(self) -> WorkbenchSnapshot:
        baseline, event, revision = self.repository.snapshot()
        return WorkbenchSnapshot(
            baseline,
            event,
            revision,
            self.snapshot_time,
            self.machines,
            self.orders,
            tuple(op.id for op in affected_operations(baseline, event)),
            failure_issues(baseline, event, self.machines),
            self.repository.history(),
            self.repository.plan_metadata(baseline.version),
            self.repository.operation_labels(baseline),
        )

    def save_event(self, command: SaveEvent) -> WorkbenchSnapshot:
        self.checked_snapshot(command.version)
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
        for event in (*history, self.example):
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
            baseline, event, self.machines, self.orders, event_revision=revision
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
        result = self.repository.decide(
            candidate, event, self.machines, command.action, command.reason, command.request_id
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
        return outcome.payload, simulation

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
