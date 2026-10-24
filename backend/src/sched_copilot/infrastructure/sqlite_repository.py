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
from ..domain.scheduling import affected_operations, validate_schedule
from . import fault_reviews
from .event_deletion import delete_related
from .fault_publication import fault_publication
from .manual_faults import SCHEMA as MANUAL_SCHEMA
from .manual_faults import ManualFaultStore
from .manual_faults import gate as manual_gate
from .plan_publication import (
    insertion_publication,
    plan_timeline,
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


def replace_database(source_path: Path, target_path: Path) -> None:
    source = sqlite3.connect(source_path)
    target = sqlite3.connect(target_path)
    try:
        source.backup(target)
    finally:
        source.close()
        target.close()


class DecisionStore(ManualFaultStore):
    def __init__(self, path: str | Path, baseline: Schedule):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS current_plan (
                    id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS event_deletion_state (
                    id INTEGER PRIMARY KEY CHECK(id=1)
                );
                CREATE TABLE IF NOT EXISTS empty_event (
                    id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL
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
                CREATE TABLE IF NOT EXISTS cancelled_events (
                    revision INTEGER PRIMARY KEY, reason TEXT NOT NULL, cancelled_at TEXT NOT NULL
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
            conn.executescript(fault_reviews.SCHEMA)
            conn.executescript(MANUAL_SCHEMA)
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
                "SELECT payload,simulation_id,created_at FROM workflow_runs "
                "ORDER BY sequence DESC LIMIT 1"
            ).fetchone()
        if not row:
            return None
        payload = json.loads(row[0])
        payload.setdefault("created_at", row[2])
        return payload, row[1]

    def fault_analysis(self, revision: int) -> dict | None:
        """Prefer the actual publication, retaining both source variants for audit."""
        with self._connect() as conn:
            for (raw,) in conn.execute(
                "SELECT evidence FROM decisions WHERE action='publish' ORDER BY id DESC"
            ).fetchall():
                evidence = json.loads(raw)
                if evidence.get("candidate", {}).get("event_revision") == revision:
                    return fault_publication(conn, evidence)
            rows = conn.execute(
                "SELECT w.payload,s.candidates,s.event FROM workflow_runs w "
                "LEFT JOIN simulations s ON s.id=w.simulation_id ORDER BY w.sequence DESC"
            ).fetchall()
            for raw, candidates, event in rows:
                payload = json.loads(raw)
                if (
                    payload.get("intent") != "generate_candidates"
                    or payload.get("status") != "completed"
                ):
                    continue
                assessment = (
                    payload.get("results", {}).get("evaluation", {}).get("data") or {}
                ).get("assessment")
                if assessment and payload["context"]["event_version"] == revision:
                    return {
                        "event_revision": revision,
                        "baseline_version": int(payload["context"]["current_plan_version"]),
                        "workflow": payload,
                    }
                if not candidates:
                    continue
                plans = parse_candidates(candidates)
                if plans and plans[0].event_revision == revision:
                    return fault_publication(
                        conn,
                        {
                            "candidate": asdict(plans[0]),
                            "event": json.loads(event),
                        },
                    )
        return None

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

    def plan_metadata(self, version, event_revision=None):
        with self._connect() as conn:
            timeline = plan_timeline(conn, version)
            rows = conn.execute(
                "SELECT created_at,result,evidence FROM decisions "
                "WHERE action='publish' ORDER BY id DESC"
            ).fetchall()
            fault_traces = []
            current_fault_analysis = None
            for _created_at, payload, raw in reversed(rows):
                published_version = raw_version(payload)
                evidence = json.loads(raw)
                if (
                    published_version > version
                    or "event" not in evidence
                    or "candidate" not in evidence
                ):
                    continue
                analysis = fault_publication(conn, evidence)
                if analysis["event_revision"] == event_revision:
                    current_fault_analysis = analysis
                fault_traces.append(
                    {
                        "version": published_version,
                        "event_revision": analysis["event_revision"],
                        "failure": asdict(parse_event(json.dumps(evidence["event"]))),
                        "candidate_label": evidence["candidate"]["label"],
                        "metrics": asdict(
                            parse_candidates(json.dumps([evidence["candidate"]]))[0].metrics
                        ),
                        "affected_operations": [
                            op
                            for op in (analysis.get("baseline") or {}).get("operations", [])
                            if op["id"] in (analysis.get("affected") or [])
                        ],
                    }
                )
            for created_at, payload, raw in rows:
                if raw_version(payload) == version:
                    evidence = json.loads(raw)
                    return {
                        **publication_info(version, created_at, evidence),
                        "history": timeline,
                        "fault_traces": fault_traces,
                        "fault_analysis": fault_publication(conn, evidence),
                        "current_fault_analysis": current_fault_analysis,
                    }
        return {
            "version": version,
            "history": timeline,
            "fault_traces": fault_traces,
            "current_fault_analysis": current_fault_analysis,
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

    def event_history(self) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT h.revision,h.payload,h.recorded_at,c.revision FROM event_history h "
                "LEFT JOIN cancelled_events c ON c.revision=h.revision ORDER BY h.revision DESC"
            ).fetchall()
        return [
            {
                **json.loads(payload),
                "revision": revision,
                "created_at": created_at,
                "cancelled": cancelled is not None,
            }
            for revision, payload, created_at, cancelled in rows
        ]

    def event_cancelled(self, revision: int) -> bool:
        with self._connect() as conn:
            return (
                conn.execute(
                    "SELECT 1 FROM cancelled_events WHERE revision=? "
                    "UNION ALL SELECT 1 FROM empty_event WHERE revision=?",
                    (revision, revision),
                ).fetchone()
                is not None
            )

    def cancel_event(self, expected_revision: int, fingerprint: str, target_revision=None) -> None:
        """Physically delete every revision of one outage and its dependent artifacts."""
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            latest = conn.execute(
                "SELECT revision FROM event_history ORDER BY revision DESC LIMIT 1"
            ).fetchone()
            empty = conn.execute("SELECT revision FROM empty_event WHERE id=1").fetchone()
            revision = empty[0] if empty else (latest[0] if latest else 0)
            baseline = parse_schedule(
                conn.execute("SELECT payload FROM current_plan WHERE id=1").fetchone()[0]
            )
            if revision != expected_revision or baseline.fingerprint != fingerprint:
                raise RuleViolation("事件或计划已更新，请刷新后再撤销")
            target = target_revision if target_revision is not None else revision
            row = conn.execute(
                "SELECT payload FROM event_history WHERE revision=?", (target,)
            ).fetchone()
            if not row:
                raise RuleViolation("故障已删除，请刷新后查看")
            event = parse_event(row[0])
            family = (event.machine_id, event.started_at)
            revisions = {
                rev
                for rev, raw in conn.execute("SELECT revision,payload FROM event_history")
                if (parse_event(raw).machine_id, parse_event(raw).started_at) == family
            }
            delete_related(conn, revisions, family)
            conn.execute("INSERT OR IGNORE INTO event_deletion_state VALUES (1)")
            # Advance the technical revision even when deleting an older blocking window.
            # SQLite's sequence survives deletion; the empty marker stores no fault data.
            remaining = conn.execute(
                "SELECT fingerprint,payload FROM event_history WHERE revision NOT IN "
                "(SELECT revision FROM cancelled_events) ORDER BY revision DESC LIMIT 1"
            ).fetchone()
            conn.execute("DELETE FROM current_event")
            conn.execute("DELETE FROM empty_event")
            if remaining:
                conn.execute("INSERT INTO current_event VALUES (1,?,?)", remaining)
                conn.execute(
                    "INSERT INTO event_history VALUES (NULL,?,?,?)",
                    (*remaining, datetime.now(timezone.utc).isoformat()),
                )
            else:
                sequence = (
                    conn.execute(
                        "SELECT seq FROM sqlite_sequence WHERE name='event_history'"
                    ).fetchone()[0]
                    + 1
                )
                conn.execute(
                    "UPDATE sqlite_sequence SET seq=? WHERE name='event_history'", (sequence,)
                )
                conn.execute("INSERT INTO empty_event VALUES (1,?)", (sequence,))

    def has_deleted_events(self) -> bool:
        with self._connect() as conn:
            return conn.execute("SELECT 1 FROM event_deletion_state").fetchone() is not None

    @staticmethod
    def _empty_snapshot(baseline, revision):
        # Compatibility DTO only: never persisted or accepted for analysis.
        start = min(
            (op.start for op in baseline.operations),
            default=datetime(1970, 1, 1, tzinfo=timezone.utc),
        )
        return MachineFailure("", start, None, "待录入故障", start), revision

    def active_event(self) -> tuple[MachineFailure, int] | None:
        with self._connect() as conn:
            empty = conn.execute("SELECT revision FROM empty_event WHERE id=1").fetchone()
            if empty:
                return self._empty_snapshot(self.current(), empty[0])
            row = conn.execute(
                "SELECT payload, revision FROM event_history ORDER BY revision DESC LIMIT 1"
            ).fetchone()
        return (parse_event(row[0]), row[1]) if row else None

    def failure_windows(self) -> tuple[MachineFailure, ...]:
        """Keep independent outages; a revision of the same start replaces its older value."""
        windows = {}
        for item in self.event_history():
            if item["cancelled"]:
                continue
            payload = {
                k: v for k, v in item.items() if k not in {"revision", "created_at", "cancelled"}
            }
            event = parse_event(json.dumps(payload))
            windows.setdefault((event.machine_id, event.started_at), event)
        values = tuple(windows.values())
        if len(values) > 1:
            values = tuple(item for item in values if item.source != "系统初始化示例")
        return values

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
            empty = conn.execute("SELECT revision FROM empty_event WHERE id=1").fetchone()
        if empty:
            event, revision = self._empty_snapshot(baseline, empty[0])
            return baseline, event, revision
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
                "SELECT revision, payload FROM event_history WHERE revision NOT IN "
                "(SELECT revision FROM cancelled_events) ORDER BY revision DESC"
            ).fetchall()
            revision = conn.execute("SELECT MAX(revision) FROM event_history").fetchone()[0] or 0
            if expected_revision is not None and expected_revision != revision:
                raise RuleViolation("事件已在其他页面更新，请重新载入后恢复")
            event = choose_event(baseline, tuple(parse_event(row[1]) for row in history))
            if history and digest(event) == digest(parse_event(history[0][1])):
                return revision
            payload = json.dumps(asdict(event), default=str, ensure_ascii=False)
            conn.execute("DELETE FROM empty_event")
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
            empty = conn.execute("SELECT revision FROM empty_event WHERE id=1").fetchone()
            revision = empty[0] if empty else (latest[0] if latest else 0)
            if expected_revision is not None and revision != expected_revision:
                raise RuleViolation("事件已在其他页面更新，请重新载入后编辑")
            if (
                not empty
                and latest
                and latest[1] == fingerprint
                and not conn.execute(
                    "SELECT 1 FROM cancelled_events WHERE revision=?", (revision,)
                ).fetchone()
            ):
                return revision
            payload = json.dumps(asdict(event), default=str, ensure_ascii=False)
            conn.execute("DELETE FROM empty_event")
            conn.execute(
                "INSERT OR REPLACE INTO current_event VALUES (1, ?, ?)",
                (fingerprint, payload),
            )
            cursor = conn.execute(
                "INSERT INTO event_history VALUES (NULL, ?, ?, ?)",
                (fingerprint, payload, datetime.now(timezone.utc).isoformat()),
            )
            return cursor.lastrowid

    def fault_review(self, revision, fingerprint):
        with self._connect() as conn:
            return fault_reviews.current_review(conn, revision, fingerprint)

    def submit_fault_review(self, simulation_id, candidate_id, reason, request_id):
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            return fault_reviews.submit(conn, simulation_id, candidate_id, reason, request_id)

    def review_fault(self, review_id, action, reason):
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            return fault_reviews.review(conn, review_id, action, reason)

    def submit_assessment_review(self, workflow_id, reason, request_id):
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            return fault_reviews.submit_assessment(conn, workflow_id, reason, request_id)

    def decide(
        self,
        candidate: CandidatePlan,
        event: MachineFailure,
        machines: tuple[Machine, ...],
        action: str,
        reason: str,
        request_id: str,
        approval_simulation_id: str | None = None,
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
            failure_rows = conn.execute(
                "SELECT payload FROM event_history WHERE revision NOT IN "
                "(SELECT revision FROM cancelled_events) ORDER BY revision DESC"
            ).fetchall()
            windows = {}
            for row in failure_rows:
                saved_failure = parse_event(row[0])
                windows.setdefault(
                    (saved_failure.machine_id, saved_failure.started_at), saved_failure
                )
            saved_windows = tuple(windows.values())
            if len(saved_windows) > 1:
                saved_windows = tuple(
                    item for item in saved_windows if item.source != "系统初始化示例"
                )
            additional = tuple(f for f in saved_windows if f != event)
            errors = validate_schedule(candidate.schedule, machines, event, baseline, additional)
            if errors:
                raise RuleViolation("发布校验失败：" + "; ".join(errors))
            if candidate.schedule.version != baseline.version + 1:
                raise RuleViolation("候选版本号无效")
            if action == "publish" and approval_simulation_id is not None:
                manual_gate(conn, approval_simulation_id, candidate)
                fault_reviews.require_approval(conn, candidate, approval_simulation_id)
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
                            "affected": [op.id for op in affected_operations(baseline, event)],
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
