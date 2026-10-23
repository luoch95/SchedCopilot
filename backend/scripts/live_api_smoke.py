"""Run one live Agent analysis against the local API without printing secrets."""

import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from sched_copilot.config import Settings

BASE_URL = os.getenv("SCHED_API_URL", "http://127.0.0.1:8000")


def request(path: str, method: str = "GET", payload: dict | None = None) -> dict:
    body = None if payload is None else json.dumps(payload).encode()
    req = Request(
        f"{BASE_URL}{path}",
        data=body,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with urlopen(req, timeout=120) as response:
        return json.loads(response.read())


def main() -> int:
    Settings.from_env()
    try:
        health = request("/api/health")
        if not health.get("live_analysis_configured"):
            print("后端未识别到完整模型配置；请重启后端再试。")
            return 2
        state = request("/api/workbench")
        result = request(
            "/api/analysis",
            "POST",
            {
                "event_revision": state["event_revision"],
                "baseline_fingerprint": state["baseline"]["fingerprint"],
                "live": True,
                "question": "请说明故障影响、等待恢复与设备转移方案的主要取舍，并引用证据。",
            },
        )
        reports = result.get("reports", {})
        if len(reports) != 3 or any(not str(report).strip() for report in reports.values()):
            print("联调失败：未得到三个非空 Agent 报告。")
            return 1
        print(f"联调成功：mode={result.get('mode')}，报告数={len(reports)}")
        for role, report in reports.items():
            print(f"- {role}: {len(str(report))} 字符")
        return 0
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        print(f"API 联调失败：HTTP {error.code}，响应已截断：{detail[:300]}")
        return 1
    except (URLError, TimeoutError) as error:
        print(f"无法连接本地 API：{type(error).__name__}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
