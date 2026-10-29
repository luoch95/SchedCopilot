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

    def details(self, current_ip, *, page=1, page_size=20, exclude_current=False):
        where = " WHERE ip != ?" if exclude_current and current_ip else ""
        params = (current_ip,) if where else ()
        with closing(sqlite3.connect(self.path)) as db:
            db.execute("BEGIN")
            total = db.execute("SELECT COUNT(*) FROM daily_visitors" + where, params).fetchone()[0]
            rows = db.execute(
                "SELECT visit_date,ip FROM daily_visitors"
                + where
                + " ORDER BY visit_date DESC,ip ASC LIMIT ? OFFSET ?",
                (*params, page_size, (page - 1) * page_size),
            ).fetchall()
        return {
            "items": [
                {"visit_date": day, "ip": ip, "matches_current_ip": ip == current_ip}
                for day, ip in rows
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
            "current_ip": current_ip,
        }
