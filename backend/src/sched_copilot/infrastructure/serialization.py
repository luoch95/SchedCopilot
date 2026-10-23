"""Stable JSON codecs for SQLite payloads; no HTTP or validation framework dependency."""

import json
from dataclasses import asdict
from datetime import datetime

from ..domain.models import (
    CandidatePlan,
    MachineFailure,
    Operation,
    Schedule,
    ScheduleMetrics,
    TaskStatus,
)


def schedule_json(schedule: Schedule, labels=None) -> str:
    data = asdict(schedule)
    for operation in data["operations"]:
        operation.update((labels or {}).get(operation["id"], {}))
    return json.dumps(data, default=str, ensure_ascii=False)


def parse_schedule(payload: str) -> Schedule:
    data = json.loads(payload)
    operations = []
    for raw in data["operations"]:
        raw.pop("display_name", None)
        raw.pop("order_display_name", None)
        raw["start"] = datetime.fromisoformat(raw["start"])
        raw["status"] = TaskStatus(raw["status"])
        operations.append(Operation(**raw))
    return Schedule(data["version"], tuple(operations))


def parse_event(payload: str) -> MachineFailure:
    data = json.loads(payload)
    for field in ("started_at", "recovered_at", "received_at"):
        data[field] = datetime.fromisoformat(data[field]) if data[field] else None
    return MachineFailure(**data)


def candidates_json(candidates: tuple[CandidatePlan, ...]) -> str:
    return json.dumps([asdict(item) for item in candidates], default=str, ensure_ascii=False)


def parse_candidates(payload: str) -> tuple[CandidatePlan, ...]:
    candidates = []
    for raw in json.loads(payload):
        raw["schedule"] = parse_schedule(json.dumps(raw["schedule"]))
        raw["metrics"]["makespan"] = datetime.fromisoformat(raw["metrics"]["makespan"])
        raw["metrics"] = ScheduleMetrics(**raw["metrics"])
        for field in ("evidence", "assumptions"):
            raw[field] = tuple(raw[field])
        raw["causes"] = tuple((key, tuple(values)) for key, values in raw.get("causes", ()))
        candidates.append(CandidatePlan(**raw))
    return tuple(candidates)
