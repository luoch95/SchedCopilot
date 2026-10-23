"""Explicit simulated master data for the fixed injection-molding demonstration."""

from datetime import timedelta

from .demo import BASE_TIME


def demo_production_inputs():
    # Different orders own different physical molds, even within the same mold family.
    assignments = {
        "O1001-OP1": "MD-A01",
        "O1001-OP2": "MD-B01",
        "O1001-OP3": "MD-A01",
        "O1002-OP1": "MD-A02",
        "O1002-OP2": "MD-B02",
        "O1003-OP1": "MD-B03",
        "O1003-OP2": "MD-B03",
        "O1004-OP1": "MD-C04",
        "O1004-OP2": "MD-B04",
        "O1005-OP1": "MD-A05",
        "O1005-OP2": "MD-A05",
    }
    compatibility = {
        "MD-A01": ["M1", "M2"],
        "MD-A02": ["M1", "M2"],
        "MD-A05": ["M1", "M2"],
        "MD-B01": ["M2", "M3"],
        "MD-B02": ["M2", "M3"],
        "MD-B03": ["M2", "M3"],
        "MD-B04": ["M2", "M3"],
        "MD-C04": ["M3"],
    }
    return {
        "dataset_id": "injection-demo-production-v1",
        "source": "仿真演示主数据 v1；非真实车间记录",
        "operation_molds": assignments,
        "molds": [
            {"mold_id": mold, "compatible_machine_ids": machines}
            for mold, machines in compatibility.items()
        ],
        "production": {
            "source": "仿真演示：双班连续覆盖08:00至24:00；不同实体模具换型15分钟",
            "shifts": [
                {
                    "machine_id": machine,
                    "start_at": BASE_TIME.replace(hour=start).isoformat(),
                    "end_at": (
                        BASE_TIME.replace(hour=16)
                        if start == 8
                        else BASE_TIME.replace(hour=0) + timedelta(days=1)
                    ).isoformat(),
                }
                for machine in ("M1", "M2", "M3")
                for start in (8, 16)
            ],
            "initial_molds": {"M1": "MD-A01", "M2": "MD-B03", "M3": "MD-B01"},
            "changeover_minutes": 15,
        },
    }


def fault_tradeoff_schedule(baseline):
    """M3四小时故障取舍案例；仅调整演示订单的未开工工序。"""
    from dataclasses import replace

    from ..domain.models import Schedule, TaskStatus

    # M2原订单21:00交付，转移O1002抢占M2后产生新增延期。
    placements = {
        "O1002-OP1": ("M1", 315, 30),
        "O1002-OP2": ("M3", 360, 120),
        "O1004-OP1": ("M3", 495, 90),
        "O1004-OP2": ("M3", 600, 60),
        "O1005-OP1": ("M2", 315, 90),
        "O1005-OP2": ("M2", 480, 300),
    }
    operations = []
    for op in baseline.operations:
        if op.id in placements:
            if op.status != TaskStatus.PLANNED:
                raise ValueError(f"{op.id}已开工或完成，不能载入演示布局")
            machine, offset, duration = placements[op.id]
            op = replace(
                op,
                machine_id=machine,
                start=BASE_TIME + timedelta(minutes=offset),
                duration_minutes=duration,
            )
        operations.append(op)
    if not placements.keys() <= {op.id for op in operations}:
        raise ValueError("当前计划缺少演示订单工序")
    return Schedule(baseline.version + 1, tuple(operations))


def fault_tradeoff_inputs(existing=None):
    """演示设备资格：O1005实体模具仅适配M2，避免无代价转移到空闲M1。"""
    from copy import deepcopy

    payload = deepcopy(existing if existing is not None else demo_production_inputs())
    mold = next(m for m in payload["molds"] if m["mold_id"] == "MD-A05")
    mold["compatible_machine_ids"] = ["M2"]
    next(m for m in payload["molds"] if m["mold_id"] == "MD-B04")["compatible_machine_ids"] = ["M3"]
    payload["dataset_id"] = "injection-demo-fault-tradeoff-v1"
    return payload
