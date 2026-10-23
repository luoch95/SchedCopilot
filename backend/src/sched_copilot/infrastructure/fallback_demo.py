"""Explicit one-shot demonstration, with an atomic persistent cooldown."""

import math
import sqlite3
from datetime import datetime, timezone
from time import time


class FallbackDemoGate:
    def __init__(self, path, clock=time):
        self.path, self.clock = str(path), clock
        with sqlite3.connect(self.path) as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS fallback_demo "
                "(id INTEGER PRIMARY KEY CHECK(id=1), retry_at REAL NOT NULL)"
            )

    def status(self):
        with sqlite3.connect(self.path) as conn:
            row = conn.execute("SELECT retry_at FROM fallback_demo WHERE id=1").fetchone()
        retry_at = row[0] if row else 0
        remaining = max(0, math.ceil(retry_at - self.clock()))
        return {
            "available": remaining == 0,
            "remaining_seconds": remaining,
            "retry_at": datetime.fromtimestamp(retry_at, timezone.utc).isoformat() if row else None,
        }

    def claim(self):
        with sqlite3.connect(self.path, timeout=10) as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT retry_at FROM fallback_demo WHERE id=1").fetchone()
            now = self.clock()
            if row and row[0] > now:
                return False
            conn.execute("INSERT OR REPLACE INTO fallback_demo VALUES (1, ?)", (now + 1200,))
        return True
