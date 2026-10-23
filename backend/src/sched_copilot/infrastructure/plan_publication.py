"""Publication display metadata; internal schedule identities remain stable."""

import json


def request_labels(rows):
    return {f"URG-{request_id}": number for request_id, number in rows}


def schedule_labels(schedule, numbers):
    return {
        op.id: {
            "display_name": f"{numbers[op.order_id]}-OP{op.sequence}",
            "order_display_name": numbers[op.order_id],
        }
        for op in schedule.operations
        if op.order_id in numbers
    }


def insertion_publication(request_no, result, planner):
    count = sum(
        op["order_id"] == result["details"]["inserted_order_id"]
        for op in result["details"]["operations"]
    )
    affected = result["summary"]["affected_order_count"]
    return {
        "published_by": planner,
        "version_summary": (
            f"发布插单申请 {request_no}，涉及 {count} 个新增工序和 {affected} 个原订单调整。"
        ),
    }


def publication_info(version, created_at, evidence):
    return {
        "version": version,
        "published_at": created_at,
        "published_by": evidence.get("published_by"),
        "version_summary": evidence.get("version_summary", "历史版本，未记录变更摘要"),
    }


def request_numbers(connection):
    exists = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='insertion_requests'"
    ).fetchone()
    return (
        request_labels(connection.execute("SELECT id,request_no FROM insertion_requests"))
        if exists
        else {}
    )


def raw_version(payload):
    return json.loads(payload)["version"]


def plan_timeline(connection, version):
    rows = connection.execute(
        "SELECT created_at,result,evidence,reason FROM decisions WHERE action='publish' ORDER BY id"
    ).fetchall()
    entries = {}
    previous = None
    numbers = request_numbers(connection)
    for created_at, payload, raw, reason in rows:
        schedule = json.loads(payload)
        evidence = json.loads(raw)
        current = schedule["version"]
        details = [reason] if reason else []
        if previous and previous["version"] == current - 1:
            old = {op["id"]: op for op in previous["operations"]}
            for op in schedule["operations"]:
                before = old.get(op["id"])
                order = numbers.get(op["order_id"], op["order_id"])
                name = f"{order}-OP{op['sequence']}"
                if before is None:
                    details.append(f"新增工序 {name}，安排至 {op['machine_id']}。")
                elif any(
                    before.get(key) != op.get(key)
                    for key in ("machine_id", "start", "duration_minutes")
                ):
                    details.append(
                        f"{name}：{before['machine_id']} / {before['start']} → "
                        f"{op['machine_id']} / {op['start']}，"
                        f"加工时长 {op['duration_minutes']} 分钟。"
                    )
            removed = set(old) - {op["id"] for op in schedule["operations"]}
            if removed:
                details.append(f"移除 {len(removed)} 道工序。")
        entries[current] = {
            **publication_info(current, created_at, evidence),
            "details": details or [evidence.get("version_summary", "未记录详细变更说明")],
        }
        previous = schedule
    return [
        entries.get(
            number,
            {
                "version": number,
                "published_at": None,
                "published_by": None,
                "version_summary": "初始演示计划" if number == 1 else "历史版本，未记录发布信息",
                "details": ["此版本未保留详细变更记录。"],
            },
        )
        for number in range(version, 0, -1)
    ]
