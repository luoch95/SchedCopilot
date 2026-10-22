import json
import sqlite3

from sched_copilot.infrastructure.plan_publication import plan_timeline


def test_timeline_describes_changes_and_uses_business_order_numbers():
    with sqlite3.connect(":memory:") as connection:
        connection.execute(
            "CREATE TABLE decisions("
            "id INTEGER PRIMARY KEY,action,created_at,result,evidence,reason)"
        )
        connection.execute("CREATE TABLE insertion_requests(id,request_no)")
        connection.execute(
            "INSERT INTO insertion_requests VALUES ('internal-id','URG-20261020-001')"
        )
        operation = {
            "id": "internal-op",
            "order_id": "URG-internal-id",
            "sequence": 1,
            "machine_id": "M3",
            "start": "2026-10-19T13:00:00+08:00",
            "duration_minutes": 60,
        }
        for version, machine in [(3, "M3"), (4, "M2")]:
            connection.execute(
                "INSERT INTO decisions VALUES (?, 'publish', ?, ?, ?, ?)",
                (
                    version,
                    "2026-10-19T14:30:00+08:00",
                    json.dumps(
                        {"version": version, "operations": [{**operation, "machine_id": machine}]}
                    ),
                    json.dumps({"published_by": "planner_01", "version_summary": "故障调整"}),
                    "交期优先",
                ),
            )
        history = plan_timeline(connection, 4)
        assert [entry["version"] for entry in history] == [4, 3, 2, 1]
        details = history[0]["details"]
        assert any("URG-20261020-001-OP1" in detail and "M2" in detail for detail in details)
        assert "internal-id" not in str(history)
        assert history[-1]["published_at"] is None
        assert history[0]["published_by"] == "planner_01"
