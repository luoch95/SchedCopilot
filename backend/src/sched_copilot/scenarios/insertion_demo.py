"""Fixed insertion routes and explicit demo resource snapshots."""

from datetime import datetime, timedelta

from ..domain.errors import RuleViolation
from ..domain.insertion import InsertionResources, ProcessStep
from .demo import BASE_TIME
from .production_demo import demo_production_inputs


def demo_routes():
    return {
        "P-DEMO-001": (ProcessStep(1, "注塑成型", "mold_a", "MD-URG-A", ("M1", "M2")),),
        "P-DEMO-002": (ProcessStep(1, "注塑成型", "mold_b", "MD-URG-B", ("M2", "M3")),),
        "P-DEMO-003": (
            ProcessStep(1, "注塑成型", "mold_c", "MD-URG-C", ("M3",)),
            ProcessStep(2, "整形定型", "mold_b", "MD-URG-FINISH", ("M2", "M3"), 20),
        ),
    }


def insertion_resources(baseline, request_id, steps, production_snapshot=None):
    data = production_snapshot or demo_production_inputs()
    production = data["production"]
    assignments = dict(data["operation_molds"])
    compatibility = {m["mold_id"]: tuple(m["compatible_machine_ids"]) for m in data["molds"]}
    for step in steps:
        assignments[f"URG-{request_id}-OP{step.sequence}"] = step.mold_id
        compatibility[step.mold_id] = step.machine_ids
    if any(o.id not in assignments for o in baseline.operations):
        raise RuleViolation("原计划工序缺少实体模具数据")
    windows = {m: [] for m in production["initial_molds"]}
    if production_snapshot:
        for window in production["shifts"]:
            windows[window["machine_id"]].append(
                (
                    datetime.fromisoformat(window["start_at"]),
                    datetime.fromisoformat(window["end_at"]),
                )
            )
        source = production["source"] + "；严格使用已保存班次，不外推未知日历"
    else:
        for machine in windows:
            for day in range(14):
                left = BASE_TIME + timedelta(days=day)
                windows[machine].append((left, left.replace(hour=0) + timedelta(days=1)))
        source = "插单模拟日历 v1：连续14天每日08:00至24:00；换模15分钟，含装模；工序不可跨夜中断"
    return InsertionResources(
        assignments,
        compatibility,
        {m: tuple(sorted(w)) for m, w in windows.items()},
        dict(production["initial_molds"]),
        production["changeover_minutes"],
        source,
    )
