"""Read a consistent snapshot without initializing or migrating the business database."""

import json
import sqlite3
from contextlib import closing
from pathlib import Path


def metric_records(path):
    with closing(sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.execute("BEGIN")
        workflows = [
            (created, json.loads(payload))
            for created, payload in db.execute("SELECT created_at,payload FROM workflow_runs")
        ]
        publications = db.execute(
            "SELECT created_at FROM decisions WHERE action='publish'"
        ).fetchall()
        reviews = [json.loads(row[0]) for row in db.execute("SELECT payload FROM fault_reviews")]
        requests = db.execute("SELECT created_at FROM insertion_requests").fetchall()
        approvals = db.execute(
            "SELECT request_id,created_at FROM request_status_history WHERE to_status='approved'"
        ).fetchall()
        events = [
            (created, json.loads(payload))
            for created, payload in db.execute(
                "SELECT recorded_at,payload FROM event_history WHERE revision NOT IN "
                "(SELECT revision FROM cancelled_events)"
            )
        ]
        # Only the latest insertion assessment is retained; it has no creation timestamp.
        assessments = db.execute(
            "SELECT COUNT(*) FROM insertion_requests WHERE assessment_json IS NOT NULL"
        ).fetchone()[0]
        visits = db.execute(
            "SELECT visit_date, COUNT(*) FROM daily_visitors GROUP BY visit_date"
        ).fetchall()
    return dict(
        workflows=workflows,
        publications=publications,
        reviews=reviews,
        requests=requests,
        approvals=approvals,
        events=events,
        insertion_assessments=assessments,
        visits=visits,
    )
