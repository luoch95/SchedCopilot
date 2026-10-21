"""Local decision log with transactional version checks and idempotent publication."""

import json
import sqlite3
from collections.abc import Callable
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from ..domain.errors import RuleViolation
from ..domain.models import (
    CandidatePlan,
    Machine,
    MachineFailure,
    Order,
    Schedule,
    digest,
)
from ..domain.scheduling import validate_schedule
from .plan_publication import (
    insertion_publication,
    publication_info,
    raw_version,
    request_numbers,
    schedule_labels,
)
from .serialization import (
    candidates_json,
    parse_candidates,
    parse_event,
    parse_schedule,
    schedule_json,
)


def backup_database(path: Path) -> Path:
    backup = (
        path.parent
        / "backups"
        / f"{path.stem}-before-production-{datetime.now():%Y%m%d-%H%M%S-%f}.sqlite3"
    )
    backup.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as source, sqlite3.connect(backup) as target:
        source.backup(target)
    return backup


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
                CREATE TABLE IF NOT EXISTS simulations (
                    id TEXT PRIMARY KEY, candidates TEXT NOT NULL, event TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS workflow_runs (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    trace_id TEXT UNIQUE NOT NULL, workflow_id TEXT UNIQUE NOT NULL,
                    created_at TEXT NOT NULL, payload TEXT NOT NULL,
                    state TEXT NOT NULL, simulation_id TEXT
                );
                CREATE TABLE IF NOT EXISTS production_inputs (
                    id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL
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

        self._restore_publication_metadata()

    def record_workflow(self, payload: dict, state: dict) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO workflow_runs "
                "(trace_id,workflow_id,created_at,payload,state) VALUES (?,?,?,?,?)",
                (
                    payload["trace_id"],
                    payload["id"],
                    datetime.now(timezone.utc).isoformat(),
                    json.dumps(payload, ensure_ascii=False),
                    json.dumps(state, ensure_ascii=False),
                ),
            )

    def workflow_session(self, workflow_id: str) -> dict | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT state FROM workflow_runs WHERE workflow_id=?", (workflow_id,)
            ).fetchone()
        return json.loads(row[0]) if row else None

    def attach_workflow_simulation(self, workflow_id: str, simulation_id: str | None) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE workflow_runs SET simulation_id=? WHERE workflow_id=?",
                (simulation_id, workflow_id),
            )

    def workflow_simulation_id(self, workflow_id: str) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT simulation_id FROM workflow_runs WHERE workflow_id=?", (workflow_id,)
            ).fetchone()
        return row[0] if row else None

    def latest_workflow(self) -> tuple[dict, str | None] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT payload,simulation_id FROM workflow_runs ORDER BY sequence DESC LIMIT 1"
            ).fetchone()
        return (json.loads(row[0]), row[1]) if row else None

    def _restore_publication_metadata(self):
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            rows = conn.execute(
                "SELECT id,created_at,result,evidence FROM decisions WHERE action='publish'"
            ).fetchall()
            numbers = request_numbers(conn)
            changes = []
            for decision_id, _created_at, _payload, raw in rows:
                evidence = json.loads(raw)
                if "version_summary" in evidence:
                    continue
                request_id = evidence.get("insertion_request_id")
                if request_id:
                    row = conn.execute(
                        "SELECT request_no FROM insertion_requests WHERE id=?",
                        (request_id,),
                    ).fetchone()
                    if not row:
                        continue
                    evidence.update(
                        insertion_publication(row[0], evidence["assessment"], "planner_01")
                    )
                elif "event" in evidence:
                    evidence.update(
                        published_by=None,
                        version_summary=(
                            f"因设备 {evidence['event']['machine_id']} 故障调整排产计划。"
                        ),
                    )
                else:
                    continue
                changes.append((json.dumps(evidence, ensure_ascii=False), decision_id))
            payload = conn.execute("SELECT payload FROM current_plan WHERE id=1").fetchone()[0]
            schedule = parse_schedule(payload)
            labeled = schedule_json(schedule, schedule_labels(schedule, numbers))
            needs_labels = json.loads(payload) != json.loads(labeled)
            if changes or needs_labels:
                backup_database(Path(self.path))
                conn.executemany("UPDATE decisions SET evidence=? WHERE id=?", changes)
                if needs_labels:
                    conn.execute("UPDATE current_plan SET payload=? WHERE id=1", (labeled,))

    def plan_metadata(self, version):
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT created_at,result,evidence FROM decisions "
                "WHERE action='publish' ORDER BY id DESC"
            ).fetchall()
        for created_at, payload, raw in rows:
            if raw_version(payload) == version:
                return publication_info(version, created_at, json.loads(raw))
        return {
            "version": version,
            "published_at": None,
            "published_by": None,
            "version_summary": "初始演示计划" if version == 1 else "历史版本，未记录发布信息",
        }

    def operation_labels(self, schedule):
        with self._connect() as conn:
            return schedule_labels(schedule, request_numbers(conn))

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=10)

    def seed_production_inputs(self, payload: dict) -> bool:
        """Only fill a missing supplementary snapshot; never replace user inputs."""
        with self._connect() as conn:
            cursor = conn.execute(
                "INSERT OR IGNORE INTO production_inputs VALUES (1, ?)",
                (json.dumps(payload, ensure_ascii=False, sort_keys=True),),
            )
            return cursor.rowcount == 1

    def production_snapshot(self) -> dict | None:
        with self._connect() as conn:
            row = conn.execute("SELECT payload FROM production_inputs WHERE id=1").fetchone()
        return json.loads(row[0]) if row else None

    def current(self) -> Schedule:
        with self._connect() as conn:
            row = conn.execute("SELECT payload FROM current_plan WHERE id=1").fetchone()
        return parse_schedule(row[0])

    def published_orders(self) -> tuple[Order, ...]:
        with self._connect() as conn:
            if not conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='insertion_requests'"
            ).fetchone():
                return ()
            rows = conn.execute(
                "SELECT id,product_id,quantity,requested_due_at FROM insertion_requests "
                "WHERE status='published' ORDER BY created_at,id"
            ).fetchall()
        return tuple(
            Order(
                f"URG-{i}",
                f"紧急插单 {product} / {qty}件",
                datetime.fromisoformat(due).replace(tzinfo=timezone.utc),
                1,
            )
            for i, product, qty, due in rows
        )

    def active_event(self) -> tuple[MachineFailure, int] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT payload, revision FROM event_history ORDER BY revision DESC LIMIT 1"
            ).fetchone()
        if not row:
            return None
        return parse_event(row[0]), row[1]

    def snapshot(self) -> tuple[Schedule, MachineFailure, int]:
        """Read the formal plan and active event in one consistent database snapshot."""
        with self._connect() as conn:
            conn.execute("BEGIN")
            baseline = parse_schedule(
                conn.execute("SELECT payload FROM current_plan WHERE id=1").fetchone()[0]
            )
            row = conn.execute(
                "SELECT payload, revision FROM event_history ORDER BY revision DESC LIMIT 1"
            ).fetchone()
        if row is None:
            raise RuleViolation("尚未保存故障事件")
        return baseline, parse_event(row[0]), row[1]

    def record_simulation(
        self, simulation_id: str, candidates: tuple[CandidatePlan, ...], event: MachineFailure
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO simulations VALUES (?, ?, ?)",
                (
                    simulation_id,
                    candidates_json(candidates),
                    json.dumps(asdict(event), default=str, ensure_ascii=False),
                ),
            )

    def simulation(
        self, simulation_id: str
    ) -> tuple[tuple[CandidatePlan, ...], MachineFailure] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT candidates, event FROM simulations WHERE id=?", (simulation_id,)
            ).fetchone()
        return (parse_candidates(row[0]), parse_event(row[1])) if row else None

    def recover_event(
        self,
        choose_event: Callable[[Schedule, tuple[MachineFailure, ...]], MachineFailure],
        expected_revision: int | None = None,
    ) -> int:
        """Apply the application's selection atomically against current persisted state."""
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            baseline = parse_schedule(
                conn.execute("SELECT payload FROM current_plan WHERE id=1").fetchone()[0]
            )
            history = conn.execute(
                "SELECT revision, payload FROM event_history ORDER BY revision DESC"
            ).fetchall()
            revision = history[0][0] if history else 0
            if expected_revision is not None and expected_revision != revision:
                raise RuleViolation("事件已在其他页面更新，请重新载入后恢复")
            event = choose_event(baseline, tuple(parse_event(row[1]) for row in history))
            if history and digest(event) == digest(parse_event(history[0][1])):
                return revision
            payload = json.dumps(asdict(event), default=str, ensure_ascii=False)
            conn.execute(
                "INSERT OR REPLACE INTO current_event VALUES (1, ?, ?)", (digest(event), payload)
            )
            cursor = conn.execute(
                "INSERT INTO event_history VALUES (NULL, ?, ?, ?)",
                (digest(event), payload, datetime.now(timezone.utc).isoformat()),
            )
            return cursor.lastrowid

    def record_event(self, event: MachineFailure, expected_revision: int | None = None) -> int:
        fingerprint = digest(event)
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            latest = conn.execute(
                "SELECT revision, fingerprint FROM event_history ORDER BY revision DESC LIMIT 1"
            ).fetchone()
            revision = latest[0] if latest else 0
            if expected_revision is not None and revision != expected_revision:
                raise RuleViolation("事件已在其他页面更新，请重新载入后编辑")
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
            raise RuleViolation("需要有效操作、人工理由和请求 ID")
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            duplicate = conn.execute(
                "SELECT candidate, action, result FROM decisions WHERE request_id=?",
                (request_id,),
            ).fetchone()
            signature = digest(candidate)
            if duplicate:
                if duplicate[:2] != (signature, action):
                    raise RuleViolation("请求 ID 已被不同操作使用")
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
                raise RuleViolation("计划版本已变化，请重新分析")
            if (
                not current_event
                or current_event[0] != digest(event)
                or candidate.event_fingerprint != digest(event)
            ):
                raise RuleViolation("事件已变化，请重新分析")
            revision = conn.execute("SELECT MAX(revision) FROM event_history").fetchone()[0]
            if candidate.event_revision != revision:
                raise RuleViolation("事件版本已变化，请重新分析")
            if action == "publish" and event.recovered_at is None:
                raise RuleViolation("恢复时间未知，不能发布候选方案")
            errors = validate_schedule(candidate.schedule, machines, event, baseline)
            if errors:
                raise RuleViolation("发布校验失败：" + "; ".join(errors))
            if candidate.schedule.version != baseline.version + 1:
                raise RuleViolation("候选版本号无效")
            result = candidate.schedule if action == "publish" else baseline
            if action == "publish":
                conn.execute(
                    "UPDATE current_plan SET payload=? WHERE id=1",
                    (schedule_json(result, schedule_labels(result, request_numbers(conn))),),
                )
            conn.execute(
                "INSERT INTO decisions VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)",
                (
                    request_id,
                    action,
                    signature,
                    reason.strip(),
                    datetime.now(timezone.utc).isoformat(),
                    schedule_json(result, schedule_labels(result, request_numbers(conn))),
                    json.dumps(
                        {
                            "candidate": asdict(candidate),
                            "event": asdict(event),
                            "published_by": "planner_01",
                            "version_summary": f"因设备 {event.machine_id} 故障调整排产计划。",
                        },
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
