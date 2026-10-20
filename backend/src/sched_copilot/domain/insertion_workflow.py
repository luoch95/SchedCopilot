"""Pure insertion result reconstruction and independently calculated report facts."""

from datetime import datetime
from math import ceil

from .errors import RuleViolation
from .insertion import InsertionResources, validate_insertion
from .models import Operation, Schedule, TaskStatus


def result_schedule(result, version):
    return Schedule(
        version,
        tuple(
            Operation(
                r["operation_id"],
                r["order_id"],
                r["sequence"],
                r["capability"],
                r["machine_id"],
                r["duration_minutes"],
                datetime.fromisoformat(r["start"]),
                TaskStatus(r["status"]),
            )
            for r in result["details"]["operations"]
        ),
    )


def result_resources(result):
    raw = result["details"]["resource_snapshot"]
    return InsertionResources(
        raw["operation_molds"],
        {k: tuple(v) for k, v in raw["mold_machines"].items()},
        {
            k: tuple((datetime.fromisoformat(a), datetime.fromisoformat(b)) for a, b in v)
            for k, v in raw["shifts"].items()
        },
        raw["initial_molds"],
        raw["changeover_minutes"],
        raw["source"],
    )


def validate_result(result, snapshot):
    schedule = result_schedule(result, snapshot.baseline.version + 1)
    errors = validate_insertion(
        schedule,
        snapshot.baseline,
        snapshot.machines,
        result_resources(result),
        snapshot.snapshot_time,
        snapshot.event,
    )
    if errors:
        raise RuleViolation("插单结果复核失败：" + "; ".join(errors))
    return schedule


def evaluate_result(result, snapshot, request):
    schedule = validate_result(result, snapshot)
    impacts = []
    for order in snapshot.orders:
        before = max(o.end for o in snapshot.baseline.operations if o.order_id == order.id)
        after = max(o.end for o in schedule.operations if o.order_id == order.id)
        old = max(0, ceil((before - order.due).total_seconds() / 60))
        new = max(0, ceil((after - order.due).total_seconds() / 60))
        impacts.append(
            dict(
                order_id=order.id,
                order_name=order.name,
                due=order.due.isoformat(),
                original_completion_at=before.isoformat(),
                projected_completion_at=after.isoformat(),
                original_lateness_minutes=old,
                projected_lateness_minutes=new,
                delay_delta_minutes=new - old,
                completion_changed=before != after,
            )
        )
    completion = max(
        o.end for o in schedule.operations if o.order_id == result["details"]["inserted_order_id"]
    )
    expected = dict(
        estimated_completion_at=completion.isoformat(),
        meets_due=completion <= datetime.fromisoformat(request["requested_due_at"]),
        affected_order_count=sum(i["completion_changed"] for i in impacts),
        newly_delayed_order_count=sum(i["delay_delta_minutes"] > 0 for i in impacts),
        order_impacts=impacts,
    )
    if expected != result["summary"]:
        raise RuleViolation("插单评估独立重算与试排摘要不一致")
    return expected


def publication_resources(result, previous):
    """Persist the exact checked calendar and physical mold assignments on publication."""
    raw = result["details"]["resource_snapshot"]
    return {
        **(previous or {}),
        "source": raw["source"],
        "operation_molds": raw["operation_molds"],
        "molds": [
            dict(mold_id=k, compatible_machine_ids=list(v)) for k, v in raw["mold_machines"].items()
        ],
        "production": dict(
            source=raw["source"],
            initial_molds=raw["initial_molds"],
            changeover_minutes=raw["changeover_minutes"],
            shifts=[
                dict(machine_id=m, start_at=a, end_at=b)
                for m, windows in raw["shifts"].items()
                for a, b in windows
            ],
        ),
    }


def label_request_operations(result, request_no):
    """Attach business labels without changing scheduling IDs or approval evidence."""
    if result is None:
        return None
    result["request_no"] = request_no
    inserted_id = result["details"]["inserted_order_id"]
    for operation in result["details"]["operations"]:
        if operation["order_id"] == inserted_id:
            operation["display_name"] = f"{request_no}-OP{operation['sequence']}"
            operation["order_display_name"] = request_no
    return result
