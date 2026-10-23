"""Engineering observations, never scheduling or approval decisions."""

from datetime import datetime, timedelta, timezone

LOCAL = timezone(timedelta(hours=8))


def read_metrics(records, *, weekly=False, now=None):
    now = (now or datetime.now(LOCAL)).astimezone(LOCAL)
    week = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=now.weekday())
    trend = {
        (week + timedelta(days=i)).date().isoformat(): dict(
            label=(week + timedelta(days=i)).strftime("%m-%d"), generated=0, published=0
        )
        for i in range((now.date() - week.date()).days + 1)
    }

    def timestamp(raw):
        value = datetime.fromisoformat(raw)
        return value.replace(tzinfo=value.tzinfo or timezone.utc).astimezone(LOCAL)

    def included(raw):
        return (week if weekly else datetime.min.replace(tzinfo=LOCAL)) <= timestamp(raw) <= now

    ai = dict(generated=0, adopted=0, published=0, failed=0, degraded=0, risk_interceptions=0)
    for created, workflow in records["workflows"]:
        if not included(created):
            continue
        results = workflow.get("results", {})
        scheduling = results.get("scheduling", {}).get("data") or {}
        generated = (
            workflow["intent"] == "generate_candidates"
            and workflow["status"] == "completed"
            and bool(scheduling.get("candidates"))
        )
        ai["generated"] += generated
        ai["failed"] += workflow["status"] == "failed"
        # A rules-only execution is not a model failure. Count each affected run once.
        ai["degraded"] += any(
            (step.get("execution") or {}).get("mode") == "fallback"
            and not (step.get("execution") or {}).get("simulated", False)
            for step in workflow.get("trace", [])
        )
        validation = results.get("validation", {})
        evaluation = results.get("evaluation", {}).get("data") or {}
        ai["risk_interceptions"] += workflow["intent"] in {"generate_candidates", "validate"} and (
            (validation.get("data") or {}).get("can_generate_candidates") is False
            or (evaluation.get("assessment") or {}).get("outcome") == "no_feasible_candidate"
        )
        day = timestamp(created).date().isoformat()
        if day in trend:
            trend[day]["generated"] += generated
    for (created,) in records["publications"]:
        if included(created):
            ai["published"] += 1
            day = timestamp(created).date().isoformat()
            if day in trend:
                trend[day]["published"] += 1
    ai["adopted"] = sum(
        r["status"] in {"approved", "published"}
        and r.get("kind") != "assessment"
        and bool(r.get("reviewed_at"))
        and included(r["reviewed_at"])
        for r in records["reviews"]
    ) + len({request for request, created in records["approvals"] if included(created)})
    # Same-cohort adoption cannot be reconstructed for overwritten insertion assessments.
    ai["adoption_rate"] = None
    faults = {
        (event["machine_id"], event["started_at"])
        for created, event in records["events"]
        if included(created) and event.get("source") != "系统初始化示例"
    }
    return dict(
        source="business_records",
        period=dict(
            start=week.isoformat() if weekly else None,
            end=now.isoformat(),
            timezone="Asia/Shanghai",
        ),
        visits=dict(
            source="daily_ip_uv",
            total=sum(
                count
                for day, count in records["visits"]
                if (week.date() if weekly else datetime.min.date())
                <= datetime.fromisoformat(day).date()
                <= now.date()
            ),
            roles_source="mock",
            roles=dict(sales=31, planner=44, leader=25),
        ),
        ai=ai,
        capacity_saved_minutes=None,
        scenarios=dict(
            equipment_failure=len(faults),
            urgent_insertion=sum(included(r[0]) for r in records["requests"]),
        ),
        trend=list(trend.values()),
        limitations=[
            "访问量为北京时间每日 IP 去重 UV 之和，同一 IP 跨日重复计数；"
            "从上线后开始记录，不等于真实人数。角色占比仍为 Mock。",
            "方案生成按成功产出候选的故障生成批次计数；校验、重评、解释与无候选不计入。",
            f"插单仅保留最新评估快照（现有 {records['insertion_assessments']} 份），"
            "无评估时间与完整调用历史，未计入生成、失败、降级及趋势。",
            "采纳按已批准的可执行故障方案与插单申请计数；批准无候选结论不计入。缺少同批次完整历史，采纳率未统计。",
            "风险拦截按禁止排产的校验与无候选结论计次；失败为工作流 failed，"
            "降级不含主动规则模式和模拟故障。",
            "产能节省未建立统一口径，未统计；不将延期改善换算为产能。趋势为本周每日真实记录。",
        ],
    )
