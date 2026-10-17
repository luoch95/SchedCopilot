"""Deterministic tools shared by UI, agents and publication checks."""

from collections import defaultdict
from collections.abc import Mapping
from datetime import datetime, timedelta

from .errors import RuleViolation
from .models import (
    CandidatePlan,
    Machine,
    MachineFailure,
    Operation,
    Order,
    Schedule,
    ScheduleMetrics,
    TaskStatus,
    digest,
)

ASSUMPTIONS = (
    "仿真数据；连续工作日历，未建模班次、物料、人员和模具保养",
    "注塑周期和当前批次内生产时长固定；模具族决定设备资格，换型准备时间暂作为业务假设",
    "合格替代注塑机的成型时长相同；预计恢复时间由人工提供，存在不确定性",
    "按交期、优先级生成规则方案；不承诺最优解，不提前原计划开工时间",
)


def overlaps(start: datetime, end: datetime, other_start: datetime, other_end: datetime) -> bool:
    return start < other_end and other_start < end


def validate_schedule(
    schedule: Schedule,
    machines: tuple[Machine, ...],
    failure: MachineFailure | None = None,
    baseline: Schedule | None = None,
) -> tuple[str, ...]:
    errors: list[str] = []
    machine_map = {machine.id: machine for machine in machines}
    by_machine: dict[str, list[Operation]] = defaultdict(list)
    by_order: dict[str, list[Operation]] = defaultdict(list)
    ids = [op.id for op in schedule.operations]
    if len(ids) != len(set(ids)):
        errors.append("存在重复工序 ID")
    if not ids:
        errors.append("计划不能为空")
    if baseline and set(ids) != {op.id for op in baseline.operations}:
        errors.append("候选方案不能增删工序")
    for op in schedule.operations:
        machine = machine_map.get(op.machine_id)
        if not machine or op.capability not in machine.capabilities:
            errors.append(f"{op.id} 设备资格不符")
        if op.duration_minutes <= 0:
            errors.append(f"{op.id} 加工时长必须为正")
        if op.start.utcoffset() is None:
            errors.append(f"{op.id} 缺少时区")
        by_machine[op.machine_id].append(op)
        by_order[op.order_id].append(op)
        if failure and failure.recovered_at and op.machine_id == failure.machine_id:
            if overlaps(op.start, op.end, failure.started_at, failure.recovered_at):
                errors.append(f"{op.id} 与设备故障窗口冲突")
        if baseline:
            original = next((item for item in baseline.operations if item.id == op.id), None)
            if original:
                fields = ("order_id", "sequence", "capability", "duration_minutes", "status")
                if any(getattr(op, name) != getattr(original, name) for name in fields):
                    errors.append(f"{op.id} 工序定义被修改")
                if original.status != TaskStatus.PLANNED and op != original:
                    errors.append(f"{op.id} 已开工或完成，必须固定")
                if failure and op.status == TaskStatus.PLANNED and op.start < failure.started_at:
                    errors.append(f"{op.id} 被排入事件之前")
    for machine, operations in by_machine.items():
        ordered = sorted(operations, key=lambda op: op.start)
        for left, right in zip(ordered, ordered[1:]):
            if left.end > right.start:
                errors.append(f"{machine}: {left.id} 与 {right.id} 重叠")
    for order, operations in by_order.items():
        ordered = sorted(operations, key=lambda op: op.sequence)
        if len({op.sequence for op in ordered}) != len(ordered):
            errors.append(f"{order} 工序序号重复")
        for left, right in zip(ordered, ordered[1:]):
            if left.end > right.start:
                errors.append(f"{order}: {left.id} 必须先于 {right.id}")
    return tuple(errors)


def affected_operations(schedule: Schedule, failure: MachineFailure) -> tuple[Operation, ...]:
    return tuple(
        op
        for op in schedule.operations
        if op.machine_id == failure.machine_id
        and op.status == TaskStatus.PLANNED
        and op.end > failure.started_at
        and (failure.recovered_at is None or op.start < failure.recovered_at)
    )


def metrics(schedule: Schedule, orders: tuple[Order, ...], baseline: Schedule) -> ScheduleMetrics:
    completion: dict[str, datetime] = {}
    for op in schedule.operations:
        completion[op.order_id] = max(completion.get(op.order_id, op.end), op.end)
    lateness = [
        max(0, int((completion[order.id] - order.due).total_seconds() // 60)) for order in orders
    ]
    original = {op.id: op for op in baseline.operations}
    moved = sum(
        op.start != original[op.id].start or op.machine_id != original[op.id].machine_id
        for op in schedule.operations
    )
    return ScheduleMetrics(
        sum(value > 0 for value in lateness), sum(lateness), moved, max(completion.values())
    )


def _available_start(
    start: datetime, duration: int, occupied: list[tuple[datetime, datetime, str]]
) -> tuple[datetime, tuple[str, ...]]:
    blockers = []
    for left, right, reference in sorted(occupied):
        if overlaps(start, start + timedelta(minutes=duration), left, right):
            start = right
            blockers.append(reference)
    return start, tuple(blockers)


def _replan(
    baseline: Schedule,
    failure: MachineFailure,
    machines: tuple[Machine, ...],
    orders: tuple[Order, ...],
    allow_transfer: bool,
    eligible_machine_ids: Mapping[str, frozenset[str]] | None = None,
) -> tuple[Schedule, tuple[tuple[str, tuple[str, ...]], ...]]:
    occupied: dict[str, list[tuple[datetime, datetime, str]]] = defaultdict(list)
    root = f"故障:{failure.machine_id}"
    occupied[failure.machine_id].append((failure.started_at, failure.recovered_at, root))
    placed = {op.id: op for op in baseline.operations if op.status != TaskStatus.PLANNED}
    for op in placed.values():
        occupied[op.machine_id].append((op.start, op.end, op.id))
    order_map = {order.id: order for order in orders}
    pending = [op for op in baseline.operations if op.status == TaskStatus.PLANNED]
    direct = {op.id for op in affected_operations(baseline, failure)}
    causes = {}
    while pending:
        eligible = [
            op
            for op in pending
            if all(
                previous.id in placed
                for previous in baseline.operations
                if previous.order_id == op.order_id and previous.sequence < op.sequence
            )
        ]
        if not eligible:
            raise RuleViolation("工序依赖无法解析")
        op = min(
            eligible,
            key=lambda item: (
                order_map[item.order_id].due,
                order_map[item.order_id].priority,
                item.start,
                item.sequence,
                item.id,
            ),
        )
        predecessors = [item for item in placed.values() if item.order_id == op.order_id]
        predecessor = max(predecessors, key=lambda item: item.end, default=None)
        earliest = max(
            op.start, failure.started_at, predecessor.end if predecessor else failure.started_at
        )
        options = []
        original_blockers = ()
        for machine in machines:
            if eligible_machine_ids is not None and machine.id not in eligible_machine_ids.get(
                op.id, frozenset()
            ):
                continue
            if op.capability not in machine.capabilities:
                continue
            if not allow_transfer and machine.id != op.machine_id:
                continue
            start, blockers = _available_start(earliest, op.duration_minutes, occupied[machine.id])
            if machine.id == op.machine_id:
                original_blockers = blockers
            options.append((start, machine.id != op.machine_id, machine.id, blockers))
        if not options:
            raise RuleViolation(f"{op.id} 无合格设备")
        start, transferred, machine_id, blockers = min(options)
        references = list(blockers)
        if op.id in direct:
            references.insert(0, root)
        if predecessor and predecessor.end > op.start:
            references.append(predecessor.id)
        if transferred:
            references.extend(original_blockers)
        causes[op.id] = tuple(dict.fromkeys(references))
        updated = op.move_to(machine_id, start)
        placed[op.id] = updated
        occupied[machine_id].append((updated.start, updated.end, updated.id))
        pending.remove(op)
    schedule = Schedule(baseline.version + 1, tuple(placed[op.id] for op in baseline.operations))
    return schedule, tuple(causes.items())


def failure_issues(
    schedule: Schedule,
    failure: MachineFailure,
    machines: tuple[Machine, ...],
) -> tuple[str, ...]:
    """Input-quality gates also apply when the recovery time is unknown."""
    issues = list(validate_schedule(schedule, machines))
    if failure.machine_id not in {machine.id for machine in machines}:
        issues.append("故障设备不存在")
    for op in schedule.operations:
        if op.status == TaskStatus.PLANNED and op.start < failure.started_at:
            issues.append(f"报工状态过期：{op.id} 在事件之前应已开工，请先确认状态")
        if op.machine_id == failure.machine_id and op.status != TaskStatus.PLANNED:
            end = failure.recovered_at or max(op.end, failure.started_at + timedelta(minutes=1))
            if overlaps(op.start, op.end, failure.started_at, end):
                issues.append(f"加工中故障：{op.id} 涉及已开工或已完成工序，需人工处理在制品")
    return tuple(issues)


def generate_candidates(
    schedule: Schedule,
    failure: MachineFailure,
    machines: tuple[Machine, ...],
    orders: tuple[Order, ...],
    event_revision: int = 0,
    *,
    strategies: tuple[str, ...] = ("wait-recovery", "allow-transfer"),
    eligible_machine_ids: Mapping[str, frozenset[str]] | None = None,
) -> tuple[CandidatePlan, ...]:
    # 新入口按明确指定的策略执行；旧调用不传参数时保留原有两方案行为。
    supported = {"wait-recovery", "allow-transfer"}
    if not strategies or len(strategies) != len(set(strategies)) or set(strategies) - supported:
        raise RuleViolation("排产策略为空、重复或尚未支持")
    if failure.recovered_at is None:
        raise RuleViolation("需要人工补充预计恢复时间，才能生成候选方案")
    issues = failure_issues(schedule, failure, machines)
    if issues:
        raise RuleViolation("; ".join(issues))
    affected = affected_operations(schedule, failure)
    candidates = []
    for strategy, label, transfer in (
        ("wait-recovery", "原设备等待恢复", False),
        ("allow-transfer", "允许合格设备转移", True),
    ):
        if strategy not in strategies:
            continue
        if affected:
            result, causes = _replan(
                schedule, failure, machines, orders, transfer, eligible_machine_ids
            )
        else:
            result, causes = Schedule(schedule.version + 1, schedule.operations), ()
        errors = validate_schedule(result, machines, failure, schedule)
        if errors:
            raise RuleViolation("候选校验失败：" + "; ".join(errors))
        evidence = (
            f"事件来源：{failure.source}；设备 {failure.machine_id}",
            "直接影响：" + ("、".join(op.id for op in affected) or "无"),
            f"基线版本：{schedule.version}；数据指纹：{schedule.fingerprint[:12]}",
            "交期取自订单记录；设备资格取自设备能力表；所有候选已通过独立校验",
        )
        candidates.append(
            CandidatePlan(
                strategy,
                label,
                result,
                metrics(result, orders, schedule),
                evidence,
                ASSUMPTIONS,
                schedule.fingerprint,
                digest(failure),
                event_revision,
                causes,
            )
        )
    return tuple(candidates)
