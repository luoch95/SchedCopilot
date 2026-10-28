"""Local diagnostic history and bounded, sanitized LangSmith export."""

import json
import sqlite3
from queue import Full, Queue
from threading import Lock, Thread


class TraceStore:
    def __init__(self, path):
        self.path = path
        with sqlite3.connect(path) as db:
            exists = db.execute(
                "SELECT 1 FROM sqlite_master WHERE name='diagnostic_runs'"
            ).fetchone()
        if not exists:
            from .sqlite_repository import backup_database

            backup_database(path)
            with sqlite3.connect(path) as db:
                db.execute(
                    "CREATE TABLE IF NOT EXISTS diagnostic_runs "
                    "(id TEXT PRIMARY KEY, started_at TEXT NOT NULL, payload TEXT NOT NULL)"
                )

    def save(self, run):
        with sqlite3.connect(self.path, timeout=3) as db:
            db.execute(
                "INSERT OR REPLACE INTO diagnostic_runs VALUES(?,?,?)",
                (run["id"], run["started_at"], json.dumps(run)),
            )

    def records(self, *, kind=None, status=None, start=None, end=None, page=1):
        clauses, values = [], []
        for key, value in (("business_type", kind), ("status", status)):
            if value:
                clauses.append(f"json_extract(payload, '$.{key}')=?")
                values.append(value)
        if start:
            clauses.append("date(started_at, '+8 hours')>=?")
            values.append(start)
        if end:
            clauses.append("date(started_at, '+8 hours')<=?")
            values.append(end)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with sqlite3.connect(self.path) as db:
            total = db.execute("SELECT COUNT(*) FROM diagnostic_runs" + where, values).fetchone()[0]
            rows = db.execute(
                "SELECT payload FROM diagnostic_runs"
                + where
                + " ORDER BY started_at DESC, id DESC LIMIT 20 OFFSET ?",
                [*values, (page - 1) * 20],
            ).fetchall()
        return {"items": [json.loads(row[0]) for row in rows], "total": total, "page": page}

    def detail(self, run_id):
        with sqlite3.connect(self.path) as db:
            row = db.execute("SELECT payload FROM diagnostic_runs WHERE id=?", (run_id,)).fetchone()
        return json.loads(row[0]) if row else None


class TraceExporter:
    def __init__(
        self,
        store,
        *,
        enabled=False,
        api_key=None,
        project="SchedCopilot",
        endpoint="https://api.smith.langchain.com",
        client_factory=None,
    ):
        self.store, self.enabled, self.api_key = store, enabled, api_key
        self.project, self.endpoint = project, endpoint
        self.client_factory = client_factory
        self.queue = Queue(maxsize=32)
        self.worker = None
        self.lock = Lock()

    def record(self, run):
        run["upload_status"] = (
            "queued"
            if self.enabled and self.api_key
            else ("not_configured" if self.enabled else "disabled")
        )
        self.store.save(run)
        if run["upload_status"] != "queued":
            return
        try:
            self.queue.put_nowait(run)
        except Full:
            run["upload_status"] = "queue_full"
            self.store.save(run)
            return
        with self.lock:
            if self.worker is None:
                self.worker = Thread(target=self._work, daemon=True, name="langsmith-export")
                self.worker.start()

    def _work(self):
        while True:
            run = self.queue.get()
            try:
                self._upload(run)
                run["upload_status"] = "uploaded"
            except Exception:
                run.update(upload_status="failed", upload_error="LANGSMITH_UPLOAD_FAILED")
                run.pop("langsmith_url", None)
            try:
                self.store.save(run)
            except Exception:
                pass
            finally:
                self.queue.task_done()

    def _upload(self, run):
        from datetime import datetime
        from uuid import UUID

        from langsmith import Client
        from urllib3.util.retry import Retry

        factory = self.client_factory or Client
        client = factory(
            api_key=self.api_key,
            api_url=self.endpoint,
            auto_batch_tracing=False,
            timeout_ms=3000,
            retry_config=Retry(total=0),
            hide_inputs=True,
            omit_traced_runtime_info=True,
        )
        nodes = [{**run, "name": run["business_type"], "kind": "chain", "parent_id": None}]
        pending = list(run["spans"])
        ordered = {run["id"]: self._order(run)}
        while pending:
            ready = [n for n in pending if n["parent_id"] is None or n["parent_id"] in ordered]
            if not ready:
                raise ValueError("Invalid diagnostic tree")
            for node in ready:
                parent = node["parent_id"] or run["id"]
                ordered[node["id"]] = ordered[parent] + "." + self._order(node)
                nodes.append({**node, "parent_id": parent})
                pending.remove(node)
        for node in nodes:
            client.create_run(
                id=UUID(node["id"]),
                name=node["name"],
                run_type=node["kind"],
                trace_id=UUID(run["id"]),
                dotted_order=ordered[node["id"]],
                parent_run_id=UUID(node["parent_id"]) if node["parent_id"] else None,
                project_name=self.project,
                inputs={},
                outputs={
                    key: node[key]
                    for key in (
                        "status",
                        "mode",
                        "error_code",
                        "elapsed_ms",
                        "input_tokens",
                        "output_tokens",
                        "model",
                        "corrections",
                        "failure_phase",
                    )
                    if key in node
                },
                start_time=datetime.fromisoformat(node["started_at"]),
                end_time=datetime.fromisoformat(node["ended_at"]),
                error=node.get("error_code") if node["status"] == "failed" else None,
                extra={
                    "metadata": {
                        key: run[key]
                        for key in (
                            "business_id",
                            "workflow_id",
                            "assessment_id",
                            "local_trace_id",
                            "plan_version",
                            "event_revision",
                            "input_fingerprint",
                        )
                        if key in run
                    }
                },
            )
        # SDK resolves the correct workspace/project URL; never create a public share link.
        remote = client.read_run(UUID(run["id"]))
        run["langsmith_url"] = client.get_run_url(run=remote, project_name=self.project)

    @staticmethod
    def _order(node):
        from datetime import datetime

        return datetime.fromisoformat(node["started_at"]).strftime("%Y%m%dT%H%M%S%fZ") + node["id"]
