"""Map typed application results to the existing browser JSON contract."""

from dataclasses import asdict

from ..application.contracts import SimulationResult, WorkbenchSnapshot
from ..domain.models import Schedule


def schedule_view(schedule: Schedule) -> dict:
    return {
        **asdict(schedule),
        "fingerprint": schedule.fingerprint,
        "operations": [{**asdict(op), "end": op.end} for op in schedule.operations],
    }


def workbench_view(snapshot: WorkbenchSnapshot) -> dict:
    return {**asdict(snapshot), "baseline": schedule_view(snapshot.baseline)}


def simulation_view(result: SimulationResult) -> dict:
    return {
        "id": result.id,
        **asdict(result.version),
        "candidates": [
            {
                **asdict(item.candidate),
                "schedule": schedule_view(item.candidate.schedule),
                "changes": item.changes,
                "order_impacts": item.order_impacts,
            }
            for item in result.candidates
        ],
    }
