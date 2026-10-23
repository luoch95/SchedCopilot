"""Physical fault deletion inside the caller's SQLite write transaction."""

import json
from datetime import datetime

from .serialization import parse_event


def delete_related(conn, revisions, family):
    """Remove dependent fault artifacts; keep published schedules and other faults."""

    def references(value):
        if isinstance(value, list):
            return any(references(item) for item in value)
        if not isinstance(value, dict):
            return False
        if value.get("event_revision") in revisions or value.get("event_version") in revisions:
            return True
        if value.get("machine_id") == family[0] and value.get("started_at"):
            if datetime.fromisoformat(value["started_at"]) == family[1]:
                return True
        return any(references(item) for item in value.values())

    workflows, simulations = set(), set()
    owned_simulations = {
        row[0]
        for row in conn.execute(
            "SELECT simulation_id FROM workflow_runs WHERE simulation_id IS NOT NULL"
        )
    }
    for workflow_id, simulation_id, payload, state in conn.execute(
        "SELECT workflow_id,simulation_id,payload,state FROM workflow_runs"
    ):
        if references(json.loads(payload)) or references(json.loads(state)):
            workflows.add(workflow_id)
            if simulation_id:
                simulations.add(simulation_id)
    for simulation_id, candidates, event in conn.execute(
        "SELECT id,candidates,event FROM simulations"
    ):
        # Legacy direct simulations do not persist all blocking windows. Invalidate
        # these computations conservatively rather than reuse an unverifiable snapshot.
        if (
            simulation_id not in owned_simulations
            or references(json.loads(candidates))
            or references(json.loads(event))
        ):
            simulations.add(simulation_id)

    def linked(value):
        if isinstance(value, list):
            return any(linked(item) for item in value)
        if not isinstance(value, dict):
            return False
        return (
            references(value)
            or value.get("workflow_id") in workflows
            or value.get("simulation_id") in simulations
            or value.get("source_simulation_id") in simulations
            or any(linked(item) for item in value.values())
        )

    drafts = set()
    for draft_id, payload in conn.execute("SELECT id,payload FROM manual_fault_drafts"):
        if linked(json.loads(payload)):
            drafts.add(draft_id)
    for draft_id, payload in conn.execute("SELECT draft_id,payload FROM manual_fault_revisions"):
        if linked(json.loads(payload)):
            drafts.add(draft_id)
    for draft_id in drafts:
        for (payload,) in conn.execute(
            "SELECT payload FROM manual_fault_revisions WHERE draft_id=?", (draft_id,)
        ):
            simulation_id = json.loads(payload).get("simulation_id")
            if simulation_id:
                simulations.add(simulation_id)
        conn.execute("DELETE FROM manual_fault_revisions WHERE draft_id=?", (draft_id,))
        conn.execute("DELETE FROM manual_fault_drafts WHERE id=?", (draft_id,))
    for review_id, simulation_id, revision, payload in conn.execute(
        "SELECT id,simulation_id,event_revision,payload FROM fault_reviews"
    ).fetchall():
        if revision in revisions or simulation_id in simulations or linked(json.loads(payload)):
            conn.execute("DELETE FROM fault_reviews WHERE id=?", (review_id,))
    for decision_id, action, raw in conn.execute(
        "SELECT id,action,evidence FROM decisions"
    ).fetchall():
        evidence = json.loads(raw)
        event = evidence.get("event")
        direct = (
            event
            and (
                parse_event(json.dumps(event)).machine_id,
                parse_event(json.dumps(event)).started_at,
            )
            == family
        )
        if direct or linked(evidence):
            if action == "publish":
                # A published plan remains a fact. Remove deleted fault evidence only.
                retained = {
                    key: evidence[key]
                    for key in ("published_by", "version_summary")
                    if key in evidence
                }
                conn.execute(
                    "UPDATE decisions SET evidence=? WHERE id=?",
                    (json.dumps(retained, ensure_ascii=False), decision_id),
                )
            else:
                conn.execute("DELETE FROM decisions WHERE id=?", (decision_id,))
    conn.executemany("DELETE FROM workflow_runs WHERE workflow_id=?", [(i,) for i in workflows])
    conn.executemany("DELETE FROM simulations WHERE id=?", [(i,) for i in simulations])
    conn.executemany("DELETE FROM cancelled_events WHERE revision=?", [(i,) for i in revisions])
    conn.executemany("DELETE FROM event_history WHERE revision=?", [(i,) for i in revisions])
