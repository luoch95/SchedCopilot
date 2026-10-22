"""Read-only provenance for a published fault adjustment, including legacy decisions."""

import json
from dataclasses import asdict
from datetime import datetime

from ..domain.impact import operation_changes, order_impacts
from ..domain.models import Order, digest
from ..domain.scheduling import affected_operations
from .plan_publication import request_numbers, schedule_labels
from .serialization import parse_candidates, parse_event, parse_schedule


def fault_publication(connection, evidence):
    if "candidate" not in evidence or "event" not in evidence:
        return None
    candidate = parse_candidates(json.dumps([evidence["candidate"]], default=str))[0]
    result = {
        "event_revision": candidate.event_revision,
        "baseline_version": candidate.schedule.version - 1,
        "affected": evidence.get("affected"),
        "workflow": None,
    }
    rows = connection.execute(
        "SELECT w.payload,w.state,s.candidates,w.created_at,s.id FROM workflow_runs w "
        "JOIN simulations s ON s.id=w.simulation_id ORDER BY w.sequence DESC"
    )
    for raw, state, candidates, created_at, simulation_id in rows:
        payload = json.loads(raw)
        if payload.get("intent") != "generate_candidates" or payload.get("status") != "completed":
            continue
        if not any(digest(item) == digest(candidate) for item in parse_candidates(candidates)):
            continue
        payload.setdefault("created_at", created_at)
        result["workflow"] = payload
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
