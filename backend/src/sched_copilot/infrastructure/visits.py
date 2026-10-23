"""Daily IP uniqueness, stored independently of scheduling state."""

import logging
import sqlite3
from contextlib import closing


class VisitStore:
    def __init__(self, path):
        self.path = path
        with closing(sqlite3.connect(path)) as db, db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS daily_visitors ("
                "visit_date TEXT NOT NULL, ip TEXT NOT NULL, "
                "PRIMARY KEY (visit_date, ip))"
            )

    def record(self, ip, day):
        try:
            with closing(sqlite3.connect(self.path, timeout=2)) as db, db:
                db.execute(
                    "INSERT OR IGNORE INTO daily_visitors(visit_date,ip) VALUES (?,?)", (day, ip)
                )
        except sqlite3.Error:
            # Analytics failure must not break workflows or disclose IPs.
            logging.getLogger("sched_copilot.visits").error("访问统计写入失败，本次访问未记录")
