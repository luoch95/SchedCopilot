"""Map typed application results to the existing browser JSON contract."""

from dataclasses import asdict

from ..application.contracts import SimulationResult, WorkbenchSnapshot
from ..domain.models import Schedule


def schedule_view(schedule: Schedule, labels=None) -> dict:
    return {
        **asdict(schedule),
        "fingerprint": schedule.fingerprint,
        "operations": [
            {**asdict(op), "end": op.end, **(labels or {}).get(op.id, {})}
            for op in schedule.operations
        ],
    }


def workbench_view(snapshot: WorkbenchSnapshot, *, overview: bool = False) -> dict:
    view = {**asdict(snapshot), "baseline": schedule_view(snapshot.baseline)}
    labels = view.pop("operation_labels")
    for operation in view["baseline"]["operations"]:
        operation.update(labels.get(operation["id"], {}))
    names = {
        op["order_id"]: op["order_display_name"]
        for op in view["baseline"]["operations"]
        if "order_display_name" in op
    }
    for order in view["orders"]:
        order["display_name"] = names.get(order["id"], order["id"])
    if overview:
        # The workbench is a first-screen endpoint. Analysis bodies remain available
        # exclusively from their detail endpoints and must not delay role switching.
        publication = view.get("plan_publication") or {}
        view["plan_publication"] = {
            key: publication[key]
            for key in (
                "version",
                "published_at",
                "published_by",
                "version_summary",
                "history",
                "fault_traces",
            )
            if key in publication
        }
        review = view.get("fault_review")
        if review:
            view["fault_review"] = {
                key: value
                for key, value in review.items()
                if key not in {"analysis", "workflow", "assessment"}
            }
    return view


def simulation_view(result: SimulationResult) -> dict:
    return {
        "id": result.id,
        **asdict(result.version),
        "candidates": [
            {
                **asdict(item.candidate),
                "schedule": schedule_view(item.candidate.schedule, result.operation_labels),
                "changes": item.changes,
                "order_impacts": item.order_impacts,
            }
            for item in result.candidates
        ],
    }
