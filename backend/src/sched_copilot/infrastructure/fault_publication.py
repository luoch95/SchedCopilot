"""Read-only provenance for a published fault adjustment, including legacy decisions."""

import json
from dataclasses import asdict
from datetime import datetime

from ..domain.impact import operation_changes, order_impacts
from ..domain.models import Order, digest
from ..domain.scheduling import affected_operations
from .plan_publication import raw_version, request_numbers, schedule_labels
from .serialization import parse_candidates, parse_event, parse_schedule


def _analysis(connection, evidence, workflow_id=None):
    if "candidate" not in evidence or "event" not in evidence:
        return None
    candidate = parse_candidates(json.dumps([evidence["candidate"]], default=str))[0]
    result = {
        "event_revision": candidate.event_revision,
        "baseline_version": candidate.schedule.version - 1,
        "affected": evidence.get("affected"),
        "workflow": None,
    }
    manual = (
        connection.execute(
            "SELECT payload FROM manual_fault_revisions WHERE "
            "json_extract(payload,'$.report') IS NOT NULL "
            "AND json_extract(payload,'$.report.draft_id')=? AND "
            "json_extract(payload,'$.revision')=?",
            (candidate.id.split(":")[1], int(candidate.id.split(":")[2])),
        ).fetchone()
        if candidate.id.startswith("manual:")
        else None
    )
    if manual:
        draft = json.loads(manual[0])
        report = draft["report"]
        result.update(
            workflow=draft.get("workflow"),
            report=report,
            baseline=draft["baseline"],
            affected=[c["工序"] for c in report["changes"]],
            simulation={
                "id": draft["simulation_id"],
                "event_revision": candidate.event_revision,
                "baseline_fingerprint": candidate.baseline_fingerprint,
                "candidates": [
                    {
                        **asdict(candidate),
                        "schedule": draft["schedule"],
                        "changes": report["changes"],
                        "order_impacts": report["order_impacts"],
                    }
                ],
            },
        )
        review = connection.execute(
            "SELECT payload FROM fault_reviews WHERE simulation_id=? ORDER "
            "BY sequence DESC LIMIT 1",
            (draft["simulation_id"],),
        ).fetchone()
        if review:
            reviewed = json.loads(review[0])
            result["decisions"] = {
                k: reviewed.get(k)
                for k in (
                    "status",
                    "candidate_id",
                    "reason",
                    "review_reason",
                    "created_at",
                    "reviewed_at",
                )
            }
        return result
    rows = connection.execute(
        "SELECT w.payload,w.state,s.candidates,w.created_at,s.id FROM workflow_runs w "
        "JOIN simulations s ON s.id=w.simulation_id ORDER BY w.sequence DESC"
    )
    for raw, state, candidates, created_at, simulation_id in rows:
        payload = json.loads(raw)
        if workflow_id is not None and payload.get("id") != workflow_id:
            continue
        if payload.get("intent") != "generate_candidates" or payload.get("status") != "completed":
            continue
        if not any(digest(item) == digest(candidate) for item in parse_candidates(candidates)):
            continue
        review = connection.execute(
            "SELECT payload FROM fault_reviews WHERE simulation_id=? "
            "ORDER BY sequence DESC LIMIT 1",
            (simulation_id,),
        ).fetchone()
        if review:
            reviewed = json.loads(review[0])
            result["decisions"] = {
                k: reviewed.get(k)
                for k in (
                    "status",
                    "candidate_id",
                    "reason",
                    "review_reason",
                    "created_at",
                    "reviewed_at",
                )
            }
        payload.setdefault("created_at", created_at)
        result["workflow"] = payload
        result["report"] = {
            **payload.get("contribution_report", {}),
            "manual_summary": "未进行人工排程调整，采用系统生成方案。",
            "decision": "采纳、审批与发布以实际操作记录为准。",
        }
        # Older publications did not persist the original impact count. Recover it
        # from the exact workflow input, never from the already-adjusted plan.
        case = json.loads(state)["validation_input"]["case_data"]
        baseline = parse_schedule(
            json.dumps(
                {
                    "version": result["baseline_version"],
                    "operations": [
                        {
                            "id": op["operation_id"],
                            "order_id": op["order_id"],
                            "sequence": op["sequence"],
                            "machine_id": op["machine_id"],
                            "capability": op["capability"],
                            "start": op["start_at"],
                            "duration_minutes": op["duration_minutes"],
                            "status": op["status"],
                        }
                        for op in case["operations"]
                    ],
                }
            )
        )
        if baseline.fingerprint == candidate.baseline_fingerprint:
            event = parse_event(json.dumps(evidence["event"]))
            result["affected"] = [op.id for op in affected_operations(baseline, event)]

            def schedule_view(schedule):
                labels = schedule_labels(schedule, request_numbers(connection))
                return {
                    **asdict(schedule),
                    "fingerprint": schedule.fingerprint,
                    "operations": [
                        {**asdict(op), "end": op.end, **labels.get(op.id, {})}
                        for op in schedule.operations
                    ],
                }

            orders = tuple(
                Order(
                    o["order_id"], o["order_id"], datetime.fromisoformat(o["due_at"]), o["priority"]
                )
                for o in case["orders"]
            )
            result["baseline"] = schedule_view(baseline)
            result["simulation"] = {
                "id": simulation_id,
                "event_revision": candidate.event_revision,
                "baseline_fingerprint": baseline.fingerprint,
                "candidates": [
                    {
                        **asdict(item),
                        "schedule": schedule_view(item.schedule),
                        "changes": operation_changes(baseline, item, event),
                        "order_impacts": order_impacts(baseline, item, orders),
                    }
                    for item in parse_candidates(candidates)
                ],
            }
        break
    return result


def fault_publication(connection, evidence):
    """Restore both variants from the same source snapshot, without executable reuse."""
    result = _analysis(connection, evidence)
    if result is None:
        return None
    candidate = evidence["candidate"]
    revision = candidate["event_revision"]
    fingerprint = candidate["baseline_fingerprint"]
    manual = None
    if candidate["id"].startswith("manual:"):
        _, draft_id, draft_revision = candidate["id"].split(":")
        row = connection.execute(
            "SELECT payload FROM manual_fault_revisions WHERE draft_id=? AND revision=?",
            (draft_id, int(draft_revision)),
        ).fetchone()
        manual = json.loads(row[0]) if row else None
    source_id = manual["workflow_id"] if manual else (result.get("workflow") or {}).get("id")
    source = connection.execute(
        "SELECT payload,simulation_id FROM workflow_runs WHERE workflow_id=?", (source_id,)
    ).fetchone()
    source_workflow = json.loads(source[0]) if source else None
    source_simulation_id = source[1] if source else None
    context = source_workflow.get("context") if source_workflow else None
    original = None
    root_id = None
    # Exact input identity also covers production conditions; event/version alone is insufficient.
    if context and context.get("input_fingerprint"):
        rows = connection.execute(
            "SELECT w.workflow_id,w.payload,s.candidates,w.simulation_id FROM workflow_runs w "
            "LEFT JOIN simulations s ON s.id=w.simulation_id ORDER BY w.sequence DESC"
        ).fetchall()
        for workflow_id, raw, candidates, simulation_id in rows:
            workflow = json.loads(raw)
            if (
                workflow.get("context") != context
                or workflow.get("intent") != "generate_candidates"
                or workflow.get("status") != "completed"
                or (
                    source_workflow.get("intent") == "generate_candidates"
                    and workflow_id != source_id
                )
                or (
                    source_workflow.get("intent") != "generate_candidates"
                    and simulation_id != source_simulation_id
                )
            ):
                continue
            root_id = workflow_id
            plans = parse_candidates(candidates) if candidates else []
            if plans:
                selected = next((p for p in plans if p.id == candidate["id"]), plans[0])
                original = _analysis(
                    connection, {**evidence, "candidate": asdict(selected)}, workflow_id
                )
            else:
                original = {
                    "event_revision": revision,
                    "baseline_version": result["baseline_version"],
                    "workflow": workflow,
                }
            break
    if not manual and root_id:
        rows = connection.execute(
            "SELECT payload FROM manual_fault_revisions WHERE "
            "json_extract(payload,'$.event_revision')=? AND "
            "json_extract(payload,'$.baseline_fingerprint')=? AND "
            "json_extract(payload,'$.status')='ready_for_review' "
            "ORDER BY rowid DESC",
            (revision, fingerprint),
        ).fetchall()
        for (raw,) in rows:
            draft = json.loads(raw)
            source = connection.execute(
                "SELECT payload,simulation_id FROM workflow_runs WHERE workflow_id=?",
                (draft["workflow_id"],),
            ).fetchone()
            if (
                source
                and json.loads(source[0]).get("context") == context
                and source[1] == (original.get("simulation") or {}).get("id")
            ):
                manual = draft
                break
    manual_analysis = None
    if manual and manual.get("simulation_id"):
        saved = connection.execute(
            "SELECT candidates FROM simulations WHERE id=?", (manual["simulation_id"],)
        ).fetchone()
        plans = parse_candidates(saved[0]) if saved else []
        if plans:
            manual_analysis = _analysis(connection, {**evidence, "candidate": asdict(plans[0])})
    result["variants"] = {
        "ai": original if manual else (original or dict(result)),
        "manual": manual_analysis,
    }
    result["selected_variant"] = "manual" if candidate["id"].startswith("manual:") else "ai"
    result["selected_candidate_id"] = candidate["id"]
    # Only a real publish decision establishes publication, never a review archive.
    for raw, payload, created_at in connection.execute(
        "SELECT evidence,result,created_at FROM decisions WHERE action='publish' ORDER BY id DESC"
    ).fetchall():
        saved = json.loads(raw).get("candidate")
        if saved and digest(parse_candidates(json.dumps([saved]))[0]) == digest(
            parse_candidates(json.dumps([candidate], default=str))[0]
        ):
            result["published_version"] = raw_version(payload)
            result["published_at"] = created_at
            break
    return result
