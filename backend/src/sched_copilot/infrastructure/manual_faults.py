"""Durable draft revisions and transactional gates shared by review and publication."""

import json

from ..domain.errors import RuleViolation
from .serialization import candidates_json, parse_schedule

SCHEMA = """
CREATE TABLE IF NOT EXISTS manual_fault_drafts (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
 revision INTEGER NOT NULL, simulation_id TEXT, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS manual_fault_revisions (
 draft_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL,
 PRIMARY KEY(draft_id, revision)
);
"""


def load(conn, draft_id=None):
    row = conn.execute(
        "SELECT payload FROM manual_fault_drafts "
        + ("WHERE id=?" if draft_id else "ORDER BY sequence DESC LIMIT 1"),
        (draft_id,) if draft_id else (),
    ).fetchone()
    return json.loads(row[0]) if row else None


def production_signature(conn):
    row = conn.execute("SELECT payload FROM production_inputs WHERE id=1").fetchone()
    return json.loads(row[0]) if row else None


def check_current(conn, draft):
    baseline = parse_schedule(
        conn.execute("SELECT payload FROM current_plan WHERE id=1").fetchone()[0]
    )
    revision = conn.execute("SELECT MAX(revision) FROM event_history").fetchone()[0]
    if (
        baseline.fingerprint != draft["baseline_fingerprint"]
        or revision != draft["event_revision"]
        or production_signature(conn) != draft["production_snapshot"]
    ):
        raise RuleViolation("计划、故障或生产条件已变化，请重新分析并创建人工草案")


def gate(conn, simulation_id, candidate=None):
    if not simulation_id:
        return None
    row = conn.execute(
        "SELECT payload FROM manual_fault_revisions WHERE "
        "json_extract(payload,'$.simulation_id')=?",
        (simulation_id,),
    ).fetchone()
    if not row:
        if candidate is not None and candidate.id.startswith("manual:"):
            raise RuleViolation("人工草案报告已过期，请重新确认并提交")
        return None
    draft = json.loads(row[0])
    latest = load(conn, draft["id"])
    if latest["revision"] != draft["revision"] or latest["simulation_id"] != simulation_id:
        raise RuleViolation("人工草案已修改，旧报告与审批失效，请重新确认并提交")
    check_current(conn, draft)
    if candidate is not None:
        # The application rechecks constraints before entering this transaction.
        # Bind the persisted candidate to the exact confirmed draft under the lock.
        record = {
            **draft["schedule"],
            "operations": [
                {key: value for key, value in op.items() if key != "end"}
                for op in draft["schedule"]["operations"]
            ],
        }
        confirmed = parse_schedule(json.dumps(record))
        if candidate.schedule.fingerprint != confirmed.fingerprint:
            raise RuleViolation("人工候选与已确认草案不一致，请重新评估")
    return draft


class ManualFaultStore:
    def manual_simulation(self, simulation_id):
        with self._connect() as conn:
            row = conn.execute(
                "SELECT payload FROM manual_fault_revisions WHERE "
                "json_extract(payload,'$.simulation_id')=?",
                (simulation_id,),
            ).fetchone()
            return json.loads(row[0]) if row else None

    def manual_draft(self, draft_id=None):
        with self._connect() as conn:
            return load(conn, draft_id)

    def save_manual_draft(self, payload, expected_revision=None, candidate=None):
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            old = load(conn, payload["id"])
            if old:
                if old["revision"] != expected_revision:
                    raise RuleViolation("草案已在其他页面修改，请重新载入")
                if candidate is not None and old["status"] == "ready_for_review":
                    raise RuleViolation("该修订已确认，请重新载入报告")
                review = conn.execute(
                    "SELECT payload FROM fault_reviews WHERE "
                    "simulation_id=? ORDER BY sequence DESC LIMIT 1",
                    (old.get("simulation_id"),),
                ).fetchone()
                if review and json.loads(review[0])["status"] == "published":
                    raise RuleViolation("已发布草案不可修改")
                if payload["revision"] != old["revision"]:
                    rows = conn.execute(
                        "SELECT id,payload FROM fault_reviews WHERE "
                        "simulation_id=? AND status IN ('pending','approved')",
                        (old.get("simulation_id"),),
                    ).fetchall()
                    for review_id, raw in rows:
                        review_payload = json.loads(raw) | {"status": "superseded"}
                        conn.execute(
                            "UPDATE fault_reviews SET status='superseded',payload=? WHERE id=?",
                            (json.dumps(review_payload, ensure_ascii=False), review_id),
                        )
            elif expected_revision is not None:
                raise RuleViolation("人工草案不存在")
            check_current(conn, payload)
            if candidate is not None:
                conn.execute(
                    "INSERT INTO simulations VALUES (?,?,?)",
                    (
                        payload["simulation_id"],
                        candidates_json((candidate,)),
                        json.dumps(payload["event"]),
                    ),
                )
            raw = json.dumps(payload, ensure_ascii=False, default=str)
            conn.execute(
                "INSERT INTO "
                "manual_fault_drafts(id,revision,simulation_id,payload) VALUES (?,?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET "
                "revision=excluded.revision,simulation_id=excluded.simulation_id,payload=excluded.payload",
                (payload["id"], payload["revision"], payload.get("simulation_id"), raw),
            )
            conn.execute(
                "INSERT OR REPLACE INTO manual_fault_revisions VALUES (?,?,?)",
                (payload["id"], payload["revision"], raw),
            )
        return json.loads(raw)
