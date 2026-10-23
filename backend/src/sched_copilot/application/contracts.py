"""Typed commands and results shared by use cases and their adapters."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

from ..domain.models import CandidatePlan, Machine, MachineFailure, Order, Schedule


@dataclass(frozen=True)
class SnapshotVersion:
    event_revision: int
    baseline_fingerprint: str


@dataclass(frozen=True)
class SaveEvent:
    version: SnapshotVersion
    machine_id: str
    started_at: datetime
    recovered_at: datetime | None
    source: str


@dataclass(frozen=True)
class Decide:
    simulation_id: str
    candidate_id: str
    action: Literal["publish", "reject"]
    reason: str
    request_id: str


@dataclass(frozen=True)
class Analyze:
    version: SnapshotVersion
    live: bool
    question: str


@dataclass(frozen=True)
class WorkbenchSnapshot:
    baseline: Schedule
    event: MachineFailure
    event_revision: int
    snapshot_time: datetime
    machines: tuple[Machine, ...]
    orders: tuple[Order, ...]
    affected: tuple[str, ...]
    issues: tuple[str, ...]
    history: list[dict]
    plan_publication: dict = field(default_factory=dict)
    operation_labels: dict = field(default_factory=dict)
    event_history: list[dict] = field(default_factory=list)
    fault_review: dict | None = None
    event_cancelled: bool = False


@dataclass(frozen=True)
class CandidateComparison:
    candidate: CandidatePlan
    changes: list[dict]
    order_impacts: list[dict]


@dataclass(frozen=True)
class SimulationResult:
    id: str
    version: SnapshotVersion
    candidates: tuple[CandidateComparison, ...]
    operation_labels: dict = field(default_factory=dict)


@dataclass(frozen=True)
class WorkflowOutcome:
    payload: dict
    candidates: tuple[CandidatePlan, ...]
