"""Domain models for the first deterministic scheduling scenario."""

import json
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timedelta
from enum import StrEnum
from hashlib import sha256


class TaskStatus(StrEnum):
    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


@dataclass(frozen=True)
class Machine:
    id: str
    name: str
    capabilities: frozenset[str]


@dataclass(frozen=True)
class Operation:
    id: str
    order_id: str
    sequence: int
    capability: str
    machine_id: str
    duration_minutes: int
    start: datetime
    status: TaskStatus = TaskStatus.PLANNED

    @property
    def end(self) -> datetime:
        return self.start + timedelta(minutes=self.duration_minutes)

    def move_to(self, machine_id: str, start: datetime) -> "Operation":
        return replace(self, machine_id=machine_id, start=start)


@dataclass(frozen=True)
class Order:
    id: str
    name: str
    due: datetime
    priority: int


@dataclass(frozen=True)
class MachineFailure:
    machine_id: str
    started_at: datetime
    recovered_at: datetime | None
    source: str
    received_at: datetime

    def __post_init__(self) -> None:
        if not self.source.strip():
            raise ValueError("事件来源不能为空")
        for value in (self.started_at, self.received_at, self.recovered_at):
            if value is not None and value.utcoffset() is None:
                raise ValueError("事件时间必须包含时区")
        if self.received_at < self.started_at:
            raise ValueError("接收时间不能早于发生时间")
        if self.recovered_at is not None and self.recovered_at <= self.started_at:
            raise ValueError("恢复时间必须晚于发生时间")


@dataclass(frozen=True)
class Schedule:
    version: int
    operations: tuple[Operation, ...]

    def by_id(self, operation_id: str) -> Operation:
        return next(op for op in self.operations if op.id == operation_id)

    @property
    def fingerprint(self) -> str:
        return digest(self)


@dataclass(frozen=True)
class ScheduleMetrics:
    late_orders: int
    total_lateness_minutes: int
    moved_operations: int
    makespan: datetime


@dataclass(frozen=True)
class CandidatePlan:
    id: str
    label: str
    schedule: Schedule
    metrics: ScheduleMetrics
    evidence: tuple[str, ...]
    assumptions: tuple[str, ...]
    baseline_fingerprint: str
    event_fingerprint: str
    event_revision: int = 0
    causes: tuple[tuple[str, tuple[str, ...]], ...] = ()


def digest(record: object) -> str:
    payload = json.dumps(asdict(record), default=str, sort_keys=True, ensure_ascii=False)
    return sha256(payload.encode()).hexdigest()
