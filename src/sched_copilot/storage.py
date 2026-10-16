"""Local decision log with transactional version checks and idempotent publication."""

import json
import sqlite3
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from .domain import (
    CandidatePlan,
    Machine,
    MachineFailure,
    Operation,
    Order,
    Schedule,
    TaskStatus,
    digest,
)
from .scheduling import generate_candidates, validate_schedule


def schedule_json(schedule: Schedule) -> str:
    return json.dumps(asdict(schedule), default=str, ensure_ascii=False)


def parse_schedule(payload: str) -> Schedule:
    data = json.loads(payload)
    operations = []
    for raw in data["operations"]:
        raw["start"] = datetime.fromisoformat(raw["start"])
        raw["status"] = TaskStatus(raw["status"])
        operations.append(Operation(**raw))
    return Schedule(data["version"], tuple(operations))


def parse_event(payload: str) -> MachineFailure:
    data = json.loads(payload)
    for field in ("started_at", "recovered_at", "received_at"):
        data[field] = datetime.fromisoformat(data[field]) if data[field] else None
    return MachineFailure(**data)


class DecisionStore:
    def __init__(self, path: str | Path, baseline: Schedule):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS current_plan (
                    id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS current_event (
                    id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL,
                    payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS decisions (
                    id INTEGER PRIMARY KEY, request_id TEXT UNIQUE NOT NULL,
                    action TEXT NOT NULL, candidate TEXT NOT NULL,
                    reason TEXT NOT NULL, created_at TEXT NOT NULL,
                    result TEXT NOT NULL, evidence TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS event_history (
                    revision INTEGER PRIMARY KEY AUTOINCREMENT,
                    fingerprint TEXT NOT NULL, payload TEXT NOT NULL,
                    recorded_at TEXT NOT NULL
                );
            """)
            conn.execute(
                "INSERT OR IGNORE INTO current_plan VALUES (1, ?)", (schedule_json(baseline),)
            )
            legacy = conn.execute(
                "SELECT fingerprint, payload FROM current_event WHERE id=1"
            ).fetchone()
            if legacy and not conn.execute("SELECT 1 FROM event_history LIMIT 1").fetchone():
                conn.execute(
                    "INSERT INTO event_history VALUES (NULL, ?, ?, ?)",
                    (*legacy, datetime.now(timezone.utc).isoformat()),
                )

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=10)

    def current(self) -> Schedule:
        with self._connect() as conn:
            row = conn.execute("SELECT payload FROM current_plan WHERE id=1").fetchone()
        return parse_schedule(row[0])

    def active_event(self) -> tuple[MachineFailure, int] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT payload, revision FROM event_history ORDER BY revision DESC LIMIT 1"
            ).fetchone()
        if not row:
            return None
        return parse_event(row[0]), row[1]

    def recover_event(
        self,
        machines: tuple[Machine, ...],
        orders: tuple[Order, ...],
        fallback: MachineFailure,
    ) -> int:
        """Restore the newest simulatable event without reverting plan or audit history."""
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            baseline = parse_schedule(
                conn.execute("SELECT payload FROM current_plan WHERE id=1").fetchone()[0]
            )
            history = conn.execute(
                "SELECT revision, payload FROM event_history ORDER BY revision DESC"
            ).fetchall()
            options = [parse_event(row[1]) for row in history] + [fallback]
            for event in options:
                try:
                    generate_candidates(baseline, event, machines, orders)
                except ValueError:
                    continue
                if history and digest(event) == digest(parse_event(history[0][1])):
                    return history[0][0]
                payload = json.dumps(asdict(event), default=str, ensure_ascii=False)
                conn.execute(
                    "INSERT OR REPLACE INTO current_event VALUES (1, ?, ?)",
                    (digest(event), payload),
                )
                cursor = conn.execute(
                    "INSERT INTO event_history VALUES (NULL, ?, ?, ?)",
                    (digest(event), payload, datetime.now(timezone.utc).isoformat()),
                )
                return cursor.lastrowid
            raise ValueError("当前执行记录没有可恢复的试算事件，请检查计划数据")

    def record_event(self, event: MachineFailure, expected_revision: int | None = None) -> int:
        fingerprint = digest(event)
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            latest = conn.execute(
                "SELECT revision, fingerprint FROM event_history ORDER BY revision DESC LIMIT 1"
            ).fetchone()
            revision = latest[0] if latest else 0
            if expected_revision is not None and revision != expected_revision:
                raise ValueError("事件已在其他页面更新，请重新载入后编辑")
            if latest and latest[1] == fingerprint:
                return revision
            payload = json.dumps(asdict(event), default=str, ensure_ascii=False)
            conn.execute(
                "INSERT OR REPLACE INTO current_event VALUES (1, ?, ?)",
                (fingerprint, payload),
            )
            cursor = conn.execute(
                "INSERT INTO event_history VALUES (NULL, ?, ?, ?)",
                (fingerprint, payload, datetime.now(timezone.utc).isoformat()),
            )
            return cursor.lastrowid

    def decide(
        self,
        candidate: CandidatePlan,
        event: MachineFailure,
        machines: tuple[Machine, ...],
        action: str,
        reason: str,
        request_id: str,
    ) -> Schedule:
        if action not in {"publish", "reject"} or not reason.strip() or not request_id:
            raise ValueError("需要有效操作、人工理由和请求 ID")
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            duplicate = conn.execute(
                "SELECT candidate, action, result FROM decisions WHERE request_id=?",
                (request_id,),
            ).fetchone()
            signature = digest(candidate)
            if duplicate:
                if duplicate[:2] != (signature, action):
                    raise ValueError("请求 ID 已被不同操作使用")
                return parse_schedule(duplicate[2])
            baseline = parse_schedule(
                conn.execute(
                    "SELECT payload FROM current_plan WHERE id=1",
                ).fetchone()[0]
            )
            current_event = conn.execute(
                "SELECT fingerprint FROM current_event WHERE id=1",
            ).fetchone()
            if candidate.baseline_fingerprint != baseline.fingerprint:
                raise ValueError("计划版本已变化，请重新分析")
            if (
                not current_event
                or current_event[0] != digest(event)
                or candidate.event_fingerprint != digest(event)
            ):
                raise ValueError("事件已变化，请重新分析")
            revision = conn.execute("SELECT MAX(revision) FROM event_history").fetchone()[0]
            if candidate.event_revision != revision:
                raise ValueError("事件版本已变化，请重新分析")
            if action == "publish" and event.recovered_at is None:
                raise ValueError("恢复时间未知，不能发布候选方案")
            errors = validate_schedule(candidate.schedule, machines, event, baseline)
            if errors:
                raise ValueError("发布校验失败：" + "; ".join(errors))
            if candidate.schedule.version != baseline.version + 1:
                raise ValueError("候选版本号无效")
            result = candidate.schedule if action == "publish" else baseline
            if action == "publish":
                conn.execute(
                    "UPDATE current_plan SET payload=? WHERE id=1", (schedule_json(result),)
                )
            conn.execute(
                "INSERT INTO decisions VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)",
                (
                    request_id,
                    action,
                    signature,
                    reason.strip(),
                    datetime.now(timezone.utc).isoformat(),
                    schedule_json(result),
                    json.dumps(
                        {"candidate": asdict(candidate), "event": asdict(event)},
                        default=str,
                        ensure_ascii=False,
                    ),
                ),
            )
            return result

    def history(self) -> list[dict]:
        with self._connect() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT id, action, reason, created_at FROM decisions ORDER BY id DESC",
            ).fetchall()
        return [dict(row) for row in rows]
