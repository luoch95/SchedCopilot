"""Transactional review gate for immutable fault candidates."""

import json
from dataclasses import asdict
from datetime import datetime, timezone
from hashlib import sha256
from types import SimpleNamespace
from uuid import uuid4

from ..domain.errors import RuleViolation
from ..domain.models import digest
from .fault_publication import fault_publication
from .serialization import parse_candidates, parse_schedule

SCHEMA = """
CREATE TABLE IF NOT EXISTS fault_reviews (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT UNIQUE NOT NULL, request_id TEXT UNIQUE NOT NULL,
 simulation_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
 signature TEXT NOT NULL, event_revision INTEGER NOT NULL,
 baseline_fingerprint TEXT NOT NULL, status TEXT NOT NULL,
 payload TEXT NOT NULL
);
"""


def current_review(conn, revision, fingerprint):
    row = conn.execute(
        "SELECT payload FROM fault_reviews WHERE event_revision=? "
        "AND baseline_fingerprint=? ORDER BY sequence DESC LIMIT 1",
        (revision, fingerprint),
    ).fetchone()
    return json.loads(row[0]) if row else None


def assessment_signature(workflow):
    return sha256(json.dumps(workflow, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def check_snapshot(conn, candidate):
    baseline = parse_schedule(
        conn.execute("SELECT payload FROM current_plan WHERE id=1").fetchone()[0]
    )
    revision = conn.execute("SELECT MAX(revision) FROM event_history").fetchone()[0]
    if (
        candidate.baseline_fingerprint != baseline.fingerprint
        or candidate.event_revision != revision
    ):
        raise RuleViolation("事件或计划版本已变化，请重新生成方案并提交审批")


def submit(conn, simulation_id, candidate_id, reason, request_id):
    if not reason.strip():
        raise RuleViolation("请填写提交审批的理由")
    duplicate = conn.execute(
        "SELECT payload FROM fault_reviews WHERE request_id=?", (request_id,)
    ).fetchone()
    if duplicate:
        saved = json.loads(duplicate[0])
        if (saved["simulation_id"], saved["candidate_id"], saved["reason"]) != (
            simulation_id,
            candidate_id,
            reason.strip(),
        ):
            raise RuleViolation("请求 ID 已被不同审批申请使用")
        return saved
    row = conn.execute(
        "SELECT candidates,event FROM simulations WHERE id=?", (simulation_id,)
    ).fetchone()
    candidate = (
        next((c for c in parse_candidates(row[0]) if c.id == candidate_id), None) if row else None
    )
    if candidate is None:
        raise RuleViolation("候选方案不存在，请重新生成")
    check_snapshot(conn, candidate)
    if not candidate.metrics.moved_operations:
        raise RuleViolation("方案与当前计划相同，无需提交审批")
    old = current_review(conn, candidate.event_revision, candidate.baseline_fingerprint)
    if old and old["status"] in {"pending", "approved"}:
        old["status"] = "superseded"
        conn.execute(
            "UPDATE fault_reviews SET status='superseded',payload=? WHERE id=?",
            (json.dumps(old, ensure_ascii=False), old["id"]),
        )
    payload = {
        "id": str(uuid4()),
        "simulation_id": simulation_id,
        "candidate_id": candidate_id,
        "event_revision": candidate.event_revision,
        "baseline_fingerprint": candidate.baseline_fingerprint,
        "status": "pending",
        "reason": reason.strip(),
        "review_reason": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "reviewed_at": None,
        "candidate_label": candidate.label,
        "metrics": asdict(candidate.metrics),
        "analysis": fault_publication(
            conn, {"candidate": asdict(candidate), "event": json.loads(row[1])}
        ),
    }
    conn.execute(
        "INSERT INTO fault_reviews VALUES(NULL,?,?,?,?,?,?,?,?,?)",
        (
            payload["id"],
            request_id,
            simulation_id,
            candidate_id,
            digest(candidate),
            candidate.event_revision,
            candidate.baseline_fingerprint,
            "pending",
            json.dumps(payload, ensure_ascii=False, default=str),
        ),
    )
    return payload


def review(conn, review_id, action, reason):
    if not reason.strip():
        raise RuleViolation("请填写审批意见")
    row = conn.execute("SELECT payload FROM fault_reviews WHERE id=?", (review_id,)).fetchone()
    if not row:
        raise RuleViolation("审批申请不存在")
    payload = json.loads(row[0])
    if payload.get("kind") == "assessment":
        workflow = assessment_workflow(conn, payload["workflow_id"])
        if assessment_signature(workflow) != payload["assessment_signature"]:
            raise RuleViolation("评估内容已变化，请重新提交审批")
        return finish_review(conn, payload, action, reason)
    raw = conn.execute(
        "SELECT candidates FROM simulations WHERE id=?", (payload["simulation_id"],)
    ).fetchone()
    candidate = next(c for c in parse_candidates(raw[0]) if c.id == payload["candidate_id"])
    check_snapshot(conn, candidate)
    return finish_review(conn, payload, action, reason)


def finish_review(conn, payload, action, reason):
    target = "approved" if action == "approve" else "rejected"
    if payload["status"] == target and payload["review_reason"] == reason.strip():
        return payload
    if payload["status"] != "pending":
        raise RuleViolation("该申请已处理或已被修改，请刷新审批列表")
    payload.update(
        status=target,
        review_reason=reason.strip(),
        reviewed_at=datetime.now(timezone.utc).isoformat(),
    )
    conn.execute(
        "UPDATE fault_reviews SET status=?,payload=? WHERE id=?",
        (target, json.dumps(payload, ensure_ascii=False), payload["id"]),
    )
    return payload


def assessment_workflow(conn, workflow_id):
    row = conn.execute(
        "SELECT payload FROM workflow_runs WHERE workflow_id=?", (workflow_id,)
    ).fetchone()
    if not row:
        raise RuleViolation("评估记录不存在，请重新生成分析")
    workflow = json.loads(row[0])
    report = workflow.get("results", {}).get("evaluation", {})
    data = report.get("data") or {}
    if (
        workflow.get("status") != "completed"
        or report.get("status") not in {"success", "warning"}
        or not data.get("assessment")
        or data.get("evaluations")
    ):
        raise RuleViolation("本次记录不是可审批的结论评估")
    context = workflow["context"]
    # The immutable workflow carries the plan version; the stored case is not a candidate.
    baseline = parse_schedule(
        conn.execute("SELECT payload FROM current_plan WHERE id=1").fetchone()[0]
    )
    check_snapshot(
        conn,
        SimpleNamespace(
            event_revision=context["event_version"], baseline_fingerprint=baseline.fingerprint
        ),
    )
    if str(baseline.version) != context["current_plan_version"]:
        raise RuleViolation("计划版本已变化，请重新生成评估")
    latest = conn.execute(
        "SELECT workflow_id FROM workflow_runs "
        "WHERE json_extract(payload,'$.intent')='generate_candidates' "
        "ORDER BY sequence DESC LIMIT 1"
    ).fetchone()
    if latest and latest[0] != workflow_id:
        raise RuleViolation("已有新的分析记录，请审批最新评估")
    return workflow


def submit_assessment(conn, workflow_id, reason, request_id):
    if not reason.strip():
        raise RuleViolation("请填写提交审批的理由")
    duplicate = conn.execute(
        "SELECT payload FROM fault_reviews WHERE request_id=?", (request_id,)
    ).fetchone()
    if duplicate:
        saved = json.loads(duplicate[0])
        if saved.get("workflow_id") != workflow_id or saved["reason"] != reason.strip():
            raise RuleViolation("请求 ID 已被不同审批申请使用")
        return saved
    workflow = assessment_workflow(conn, workflow_id)
    baseline = parse_schedule(
        conn.execute("SELECT payload FROM current_plan WHERE id=1").fetchone()[0]
    )
    revision = workflow["context"]["event_version"]
    old = current_review(conn, revision, baseline.fingerprint)
    if old and old["status"] in {"pending", "approved"}:
        old["status"] = "superseded"
        conn.execute(
            "UPDATE fault_reviews SET status='superseded',payload=? WHERE id=?",
            (json.dumps(old, ensure_ascii=False), old["id"]),
        )
    payload = {
        "id": str(uuid4()),
        "kind": "assessment",
        "workflow_id": workflow_id,
        "simulation_id": "",
        "candidate_id": "",
        "metrics": None,
        "event_revision": revision,
        "baseline_fingerprint": baseline.fingerprint,
        "status": "pending",
        "reason": reason.strip(),
        "review_reason": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "reviewed_at": None,
        "candidate_label": "当前条件下未生成可用方案的评估结论",
        "assessment": workflow["results"]["evaluation"]["data"]["assessment"],
        "workflow": workflow,
        "assessment_signature": assessment_signature(workflow),
    }
    conn.execute(
        "INSERT INTO fault_reviews VALUES(NULL,?,?,?,?,?,?,?,?,?)",
        (
            payload["id"],
            request_id,
            "",
            "",
            assessment_signature(workflow),
            revision,
            baseline.fingerprint,
            "pending",
            json.dumps(payload, ensure_ascii=False),
        ),
    )
    return payload


def require_approval(conn, candidate, simulation_id):
    saved = current_review(conn, candidate.event_revision, candidate.baseline_fingerprint)
    if (
        not saved
        or saved["status"] != "approved"
        or saved["simulation_id"] != simulation_id
        or saved["candidate_id"] != candidate.id
    ):
        raise RuleViolation("该方案尚未通过管理者审批；修改方案后必须重新提交审批")
    row = conn.execute("SELECT signature FROM fault_reviews WHERE id=?", (saved["id"],)).fetchone()
    if row[0] != digest(candidate):
        raise RuleViolation("方案内容已变化，请重新提交管理者审批")
    saved["status"] = "published"
    conn.execute(
        "UPDATE fault_reviews SET status='published',payload=? WHERE id=?",
        (json.dumps(saved, ensure_ascii=False), saved["id"]),
    )
