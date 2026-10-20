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
