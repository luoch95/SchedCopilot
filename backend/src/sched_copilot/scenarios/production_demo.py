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
