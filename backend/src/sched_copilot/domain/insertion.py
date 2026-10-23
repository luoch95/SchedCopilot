"""Independent insertion scheduler. No Agent or database dependencies."""

from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from math import ceil

from .errors import RuleViolation
from .models import Machine, MachineFailure, Operation, Order, Schedule, TaskStatus
from .scheduling import overlaps, validate_schedule


@dataclass(frozen=True)
class ProcessStep:
    sequence: int
    name: str
    capability: str
    mold_id: str
    machine_ids: tuple[str, ...]
    fixed_minutes: int = 0


@dataclass(frozen=True)
class InsertionResources:
    operation_molds: dict[str, str]
    mold_machines: dict[str, tuple[str, ...]]
    shifts: dict[str, tuple[tuple[datetime, datetime], ...]]
    initial_molds: dict[str, str]
    setup_minutes: int
    source: str


def allocations(schedule: Schedule, resources: InsertionResources) -> list[dict]:
    rows = []
    for machine_id in resources.shifts:
        previous = resources.initial_molds[machine_id]
        for op in sorted(
            (o for o in schedule.operations if o.machine_id == machine_id),
            key=lambda o: (o.start, o.id),
        ):
            mold = resources.operation_molds[op.id]
            setup = resources.setup_minutes if previous != mold else 0
            rows.append(
                dict(
                    operation_id=op.id,
                    order_id=op.order_id,
                    sequence=op.sequence,
                    machine_id=machine_id,
                    mold_id=mold,
                    capability=op.capability,
                    status=op.status.value,
                    start=op.start.isoformat(),
                    end=op.end.isoformat(),
                    duration_minutes=op.duration_minutes,
                    setup_minutes=setup,
                    setup_start=(op.start - timedelta(minutes=setup)).isoformat(),
                )
            )
            previous = mold
    return rows


def validate_insertion(
    schedule: Schedule,
    baseline: Schedule,
    machines: tuple[Machine, ...],
    resources: InsertionResources,
    earliest: datetime,
    failure: MachineFailure | None = None,
) -> tuple[str, ...]:
    errors = list(validate_schedule(schedule, machines))
    current = {op.id: op for op in schedule.operations}
    for original in baseline.operations:
        op = current.get(original.id)
        if op is None:
            errors.append(f"{original.id} 原有工序丢失")
            continue
        if original.status != TaskStatus.PLANNED and op != original:
            errors.append(f"{original.id} 已开工或完成，必须固定")
        if replace(op, machine_id=original.machine_id, start=original.start) != original:
            errors.append(f"{original.id} 原有工序定义被修改")
        if op.status == TaskStatus.PLANNED and op.start < max(original.start, earliest):
            errors.append(f"{op.id} 未开工任务不能提前")
    rows = allocations(schedule, resources)
    for row in rows:
        left = datetime.fromisoformat(row["setup_start"])
        right = datetime.fromisoformat(row["end"])
        if row["machine_id"] not in resources.mold_machines.get(row["mold_id"], ()):
            errors.append(f"{row['operation_id']} 模具与设备不兼容")
        if not any(a <= left and right <= b for a, b in resources.shifts[row["machine_id"]]):
            errors.append(f"{row['operation_id']} 换型或加工超出班次")
        if row["status"] == "planned" and left < earliest:
            errors.append(f"{row['operation_id']} 换型早于快照")
        if failure and row["status"] == "planned" and row["machine_id"] == failure.machine_id:
            if failure.recovered_at is None or overlaps(
                left, right, failure.started_at, failure.recovered_at
            ):
                errors.append(f"{row['operation_id']} 与设备停机冲突")
    for index, a in enumerate(rows):
        for b in rows[index + 1 :]:
            if (a["machine_id"] == b["machine_id"] or a["mold_id"] == b["mold_id"]) and overlaps(
                datetime.fromisoformat(a["setup_start"]),
                datetime.fromisoformat(a["end"]),
                datetime.fromisoformat(b["setup_start"]),
                datetime.fromisoformat(b["end"]),
            ):
                errors.append(f"{a['operation_id']} 与 {b['operation_id']} 设备/实体模具占用冲突")
    return tuple(dict.fromkeys(errors))


def _place(op, earliest, placed, machine_ids, machines, resources, failure, snapshot):
    options = []
    mold = resources.operation_molds[op.id]
    for machine_id in sorted(machine_ids):
        if machine_id not in resources.mold_machines[mold]:
            continue
        if not any(m.id == machine_id and op.capability in m.capabilities for m in machines):
            continue
        machine_ops = sorted(
            (o for o in placed if o.machine_id == machine_id), key=lambda o: o.start
        )
        # Scan genuine gaps, including those before future fixed operations.
        for window_start, window_end in resources.shifts[machine_id]:
            boundaries = [None, *machine_ops, None]
            for i in range(len(boundaries) - 1):
                previous, following = boundaries[i : i + 2]
                previous_mold = (
                    resources.operation_molds[previous.id]
                    if previous
                    else resources.initial_molds[machine_id]
                )
                setup = resources.setup_minutes if previous_mold != mold else 0
                next_setup = (
                    resources.setup_minutes
                    if following and resources.operation_molds[following.id] != mold
                    else 0
                )
                start = max(
                    earliest,
                    window_start + timedelta(minutes=setup),
                    snapshot + timedelta(minutes=setup),
                    previous.end + timedelta(minutes=setup) if previous else earliest,
                )
                limit = min(
                    window_end,
                    following.start - timedelta(minutes=next_setup) if following else window_end,
                )
                # A blocked interval can clear only after an occupancy or failure ends.
                for _ in range(len(placed) * 2 + 4):
                    if start + timedelta(minutes=op.duration_minutes) > limit:
                        break
                    moved = op.move_to(machine_id, start)
                    provisional = Schedule(0, tuple(placed) + (moved,))
                    rows = allocations(provisional, resources)
                    candidate = next(r for r in rows if r["operation_id"] == op.id)
                    left = datetime.fromisoformat(candidate["setup_start"])
                    end = moved.end
                    blockers = []
                    for other in rows:
                        if other["operation_id"] == op.id:
                            continue
                        if other["mold_id"] == mold and overlaps(
                            left,
                            end,
                            datetime.fromisoformat(other["setup_start"]),
                            datetime.fromisoformat(other["end"]),
                        ):
                            blockers.append(
                                datetime.fromisoformat(other["end"]) + timedelta(minutes=setup)
                            )
                    if failure and failure.machine_id == machine_id:
                        if failure.recovered_at is None:
                            break
                        if overlaps(left, end, failure.started_at, failure.recovered_at):
                            blockers.append(failure.recovered_at + timedelta(minutes=setup))
                    if blockers:
                        start = max(blockers)
                        continue
                    # Inserting before fixed work changes its setup; recheck reservations.
                    errors = validate_insertion(
                        provisional, Schedule(0, ()), machines, resources, snapshot, failure
                    )
                    if not errors:
                        options.append(moved)
                    break
    if not options:
        raise RuleViolation(f"{op.id} 在已知班次内没有满足设备、模具与换型约束的时段")
    return min(options, key=lambda o: (o.end, o.machine_id != op.machine_id, o.machine_id))


def trial_insertion(
    baseline: Schedule,
    machines: tuple[Machine, ...],
    orders: tuple[Order, ...],
    request_id: str,
    due: datetime,
    earliest: datetime,
    snapshot: datetime,
    processing_minutes: int,
    steps: tuple[ProcessStep, ...],
    resources: InsertionResources,
    failure: MachineFailure | None = None,
) -> dict:
    machine_ids = {m.id for m in machines}
    if set(resources.shifts) != machine_ids or set(resources.initial_molds) != machine_ids:
        raise RuleViolation("设备班次或初始模具数据不完整")
    if resources.setup_minutes <= 0:
        raise RuleViolation("换型时长必须为正")
    for windows in resources.shifts.values():
        if not windows or any(
            a.utcoffset() is None or b.utcoffset() is None or b <= a for a, b in windows
        ):
            raise RuleViolation("班次时间无效或缺少时区")
        if any(b > c for (_, b), (c, _) in zip(windows, windows[1:])):
            raise RuleViolation("班次窗口重叠或顺序无效")
    if any(
        m not in resources.mold_machines.get(mold, ())
        for m, mold in resources.initial_molds.items()
    ):
        raise RuleViolation("初始实体模具与设备不兼容")
    issues = validate_schedule(baseline, machines)
    if issues:
        raise RuleViolation("原计划无效：" + "; ".join(issues))
    if any(o.status == TaskStatus.PLANNED and o.start < snapshot for o in baseline.operations):
        raise RuleViolation("原计划存在快照之前尚未开工的任务，请先确认报工状态")
    if failure and any(
        o.status != TaskStatus.PLANNED
        and o.machine_id == failure.machine_id
        and overlaps(o.start, o.end, failure.started_at, failure.recovered_at or o.end)
        for o in baseline.operations
    ):
        raise RuleViolation("停机涉及固定工序，需先人工确认在制品")
    order_id = f"URG-{request_id}"
    inserted = tuple(
        Operation(
            f"{order_id}-OP{s.sequence}",
            order_id,
            s.sequence,
            s.capability,
            s.machine_ids[0],
            s.fixed_minutes or processing_minutes,
            max(earliest, snapshot),
        )
        for s in steps
    )
    if not inserted or order_id in {o.id for o in orders}:
        raise RuleViolation("插单工艺为空或订单编号冲突")
    if any(
        o.id not in resources.operation_molds
        or resources.operation_molds[o.id] not in resources.mold_machines
        for o in (*baseline.operations, *inserted)
    ):
        raise RuleViolation("实体模具映射不完整")
    placed = [o for o in baseline.operations if o.status != TaskStatus.PLANNED]
    pending = list(inserted) + [o for o in baseline.operations if o.status == TaskStatus.PLANNED]
    definitions = {o.id: o for o in (*baseline.operations, *inserted)}
    step_machines = {op.id: steps[i].machine_ids for i, op in enumerate(inserted)}
    # Urgent order first, then published order by original start. Neither fixed work nor
    # the earliest start of an existing operation is brought forward.
    while pending:
        eligible = [
            o
            for o in pending
            if all(
                p.id in {x.id for x in placed}
                for p in definitions.values()
                if p.order_id == o.order_id and p.sequence < o.sequence
            )
        ]
        if not eligible:
            raise RuleViolation("工序依赖无法解析")
        op = min(eligible, key=lambda o: (o.order_id != order_id, o.start, o.sequence, o.id))
        predecessor_end = max(
            (o.end for o in placed if o.order_id == op.order_id), default=snapshot
        )
        lower = max(op.start, snapshot, predecessor_end)
        eligible_ids = step_machines.get(
            op.id, resources.mold_machines[resources.operation_molds[op.id]]
        )
        placed.append(
            _place(op, lower, placed, eligible_ids, machines, resources, failure, snapshot)
        )
        pending.remove(op)
    result = Schedule(baseline.version, tuple(sorted(placed, key=lambda o: o.id)))
    errors = validate_insertion(result, baseline, machines, resources, snapshot, failure)
    if errors:
        raise RuleViolation("独立试排校验失败：" + "; ".join(errors))
    baseline_resource_issues = validate_insertion(
        baseline, baseline, machines, resources, snapshot, failure
    )
    old_completion = {
        order.id: max(o.end for o in baseline.operations if o.order_id == order.id)
        for order in orders
    }
    impacts = []
    for order in orders:
        old = old_completion[order.id]
        new = max(o.end for o in result.operations if o.order_id == order.id)
        old_late = max(0, ceil((old - order.due).total_seconds() / 60))
        new_late = max(0, ceil((new - order.due).total_seconds() / 60))
        impacts.append(
            dict(
                order_id=order.id,
                order_name=order.name,
                due=order.due.isoformat(),
                original_completion_at=old.isoformat(),
                projected_completion_at=new.isoformat(),
                original_lateness_minutes=old_late,
                projected_lateness_minutes=new_late,
                delay_delta_minutes=new_late - old_late,
                completion_changed=new != old,
            )
        )
    completion = max(o.end for o in result.operations if o.order_id == order_id)
    return dict(
        summary=dict(
            estimated_completion_at=completion.isoformat(),
            meets_due=completion <= due,
            affected_order_count=sum(i["completion_changed"] for i in impacts),
            newly_delayed_order_count=sum(i["delay_delta_minutes"] > 0 for i in impacts),
            order_impacts=impacts,
        ),
        details=dict(
            operations=allocations(result, resources),
            inserted_order_id=order_id,
            process_steps=[dict(sequence=s.sequence, name=s.name) for s in steps],
        ),
        baseline_resource_issues=list(baseline_resource_issues),
        assumptions=[
            "固定模拟工艺与资源，非真实车间记录",
            resources.source,
            "紧急订单优先，原订单不提前开工；规则方案不保证全局最优",
            "对比正式计划；如原计划存在换型/停机缺口，变化同时包含其约束修正，不全是插单净影响",
            "每道工序不可中断，超出已知班次不等于全局无解",
            "未建模物料、人员和模具保养；本次仅评估这一条申请，不叠加其他待审批申请",
        ],
    )
