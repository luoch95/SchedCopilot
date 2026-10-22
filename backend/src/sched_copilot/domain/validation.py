"""Read-only input-quality rules, independent of Agent and HTTP frameworks."""

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from .models import Machine, Order, Schedule, TaskStatus
from .scheduling import overlaps, validate_schedule

if TYPE_CHECKING:
    from .production import ProductionResources


@dataclass(frozen=True)
class FailureRecord:
    event_id: str
    machine_id: str
    started_at: datetime
    estimated_recovery_at: datetime | None
    received_at: datetime


@dataclass(frozen=True)
class MoldCompatibility:
    mold_id: str
    compatible_machine_ids: tuple[str, ...]


@dataclass(frozen=True)
class ValidationCase:
    schedule: Schedule
    machines: tuple[Machine, ...]
    orders: tuple[Order, ...]
    failures: tuple[FailureRecord, ...]
    molds: tuple[MoldCompatibility, ...]
    operation_molds: tuple[str | None, ...]
    unavailable_machine_ids: frozenset[str]
    report_snapshot_at: datetime
    wip_policy: str | None
    production: "ProductionResources | None" = None


@dataclass(frozen=True)
class InputIssue:
    code: str
    severity: str
    message: str
    impact: str
    repair_hint: str
    references: tuple[str, ...]


@dataclass(frozen=True)
class CaseValidation:
    issues: tuple[InputIssue, ...]
    checked_items: tuple[str, ...]
    unchecked_items: tuple[str, ...]


def validate_case(case: ValidationCase) -> CaseValidation:
    """Validate a baseline, not a candidate: planned work may intersect a fault.

    Such intersection is the reason to replan, not an invalid baseline. Existing
    schedule checks are reused without passing the failure-window argument.
    """
    issues: list[InputIssue] = []

    def add(code, message, impact, repair_hint, *refs, severity="blocking"):
        issues.append(InputIssue(code, severity, message, impact, repair_hint, refs or ("case",)))

    _check_records(case, add)
    _check_resources_and_reporting(case, add)
    _check_events(case, add)
    if case.production:
        mold_map = {m.mold_id: m for m in case.molds}
        for machine_id, mold_id in case.production.initial_molds.items():
            if (
                mold_id not in mold_map
                or machine_id not in mold_map[mold_id].compatible_machine_ids
            ):
                add(
                    "PRODUCTION_DATA_INVALID",
                    "初始装模不存在或与设备不兼容。",
                    "无法确认换型起点。",
                    "修正初始装模记录。",
                )
        for error in case.production.configuration_errors(case.schedule, case.machines):
            add(
                "PRODUCTION_DATA_INVALID",
                error,
                "班次或换型数据不可用。",
                "修正生产资源快照后重试。",
            )
    missing_mold = any(value is None for value in case.operation_molds)

    unchecked = [
        "shift_calendar",
        "material_availability",
        "staffing",
        "mold_maintenance",
        "physical_mold_occupancy",
        "changeover_duration",
    ]
    if missing_mold:
        unchecked.append("physical_mold_compatibility")
    if case.production and not case.production.configuration_errors(case.schedule, case.machines):
        unchecked = [
            item
            for item in unchecked
            if item not in {"shift_calendar", "physical_mold_occupancy", "changeover_duration"}
        ]
    return CaseValidation(
        tuple(issues),
        (
            "required_data",
            "duplicate_ids",
            "baseline_constraints",
            "order_references",
            "machine_availability",
            "mold_references",
            "report_snapshot",
            "event_time",
            "recovery_time",
            "duplicate_events",
            "wip_policy",
            "independent_failure_windows",
        ),
        tuple(unchecked),
    )


def _check_records(case: ValidationCase, add) -> None:
    collections = (
        ("order", case.orders, lambda item: item.id),
        ("operation", case.schedule.operations, lambda item: item.id),
        ("machine", case.machines, lambda item: item.id),
        ("mold", case.molds, lambda item: item.mold_id),
        ("event", case.failures, lambda item: item.event_id),
    )
    for name, records, key in collections:
        if name != "mold" and not records:
            add(
                "MISSING_DATA",
                f"缺少 {name} 数据。",
                "无法确认排产输入是否完整。",
                "补充数据后重新校验。",
            )
        for identifier, count in Counter(key(item) for item in records).items():
            if count > 1:
                add(
                    "DUPLICATE_ID",
                    f"{name} 的 ID {identifier} 重复。",
                    "记录引用不唯一。",
                    "核对并去重源记录。",
                )

    for error in validate_schedule(case.schedule, case.machines):
        add(
            "INVALID_BASELINE",
            error,
            "当前计划本身存在约束冲突。",
            "核对原始计划，不要通过修改故障时间绕过。",
        )


def _check_resources_and_reporting(case: ValidationCase, add) -> None:
    machine_ids = {item.id for item in case.machines}
    order_ids = {item.id for item in case.orders}
    mold_map = {item.mold_id: item for item in case.molds}
    fault_machines = {item.machine_id for item in case.failures}
    for index, mold in enumerate(case.molds):
        if set(mold.compatible_machine_ids) - machine_ids:
            add(
                "MOLD_MACHINE_UNKNOWN",
                f"模具 {mold.mold_id} 引用了不存在的设备。",
                "兼容清单不可靠。",
                "修正模具设备兼容表。",
                f"mold:{index}",
            )

    for index, op in enumerate(case.schedule.operations):
        ref = f"operation:{index}"
        if op.order_id not in order_ids:
            add(
                "ORDER_NOT_FOUND",
                f"工序 {op.id} 的订单不存在。",
                "无法读取交期和优先级。",
                "补充对应订单。",
                ref,
            )
        if op.machine_id in case.unavailable_machine_ids and op.machine_id not in fault_machines:
            if op.status != TaskStatus.COMPLETED:
                add(
                    "MACHINE_UNAVAILABLE",
                    f"工序 {op.id} 使用的 {op.machine_id} 不可用且没有故障窗口。",
                    "无法确定设备何时可以加工。",
                    "补充设备状态原因和可用时间。",
                    ref,
                )
        mold_id = case.operation_molds[index]
        if mold_id is None:
            add(
                "MOLD_ASSIGNMENT_MISSING",
                f"工序 {op.id} 未提供实体模具。",
                "仅能检查设备能力，不能确认实体模具兼容。",
                "补充实体模具与设备兼容记录。",
                ref,
                severity="warning",
            )
        elif mold_id not in mold_map:
            add(
                "MOLD_NOT_FOUND",
                f"工序 {op.id} 引用的模具 {mold_id} 不存在。",
                "无法确认兼容条件。",
                "补充模具记录。",
                ref,
            )
        elif op.machine_id not in mold_map[mold_id].compatible_machine_ids:
            add(
                "MOLD_MACHINE_INCOMPATIBLE",
                f"工序 {op.id} 的模具 {mold_id} 不兼容设备 {op.machine_id}。",
                "当前设备不能按给定兼容表执行该工序。",
                "核对模具与设备分配。",
                ref,
            )

        if op.status == TaskStatus.PLANNED and op.start < case.report_snapshot_at:
            add(
                "REPORT_STATUS_STALE",
                f"工序 {op.id} 计划开始时间早于报工快照，但仍标记为未开工。",
                "无法判断工序实际处于等待、加工还是已完成。",
                "确认现场状态并更新报工快照。",
                ref,
            )
        if op.status == TaskStatus.COMPLETED and op.end > case.report_snapshot_at:
            add(
                "REPORT_STATUS_CONFLICT",
                f"工序 {op.id} 标记已完成，但计划结束时间晚于报工快照。",
                "当前模型未提供实际完工时间，无法解释提前完工。",
                "核对报工和计划时间。",
                ref,
            )
        if op.status == TaskStatus.IN_PROGRESS and op.start > case.report_snapshot_at:
            add(
                "REPORT_STATUS_CONFLICT",
                f"工序 {op.id} 标记加工中，但开始时间晚于报工快照。",
                "计划和执行记录不一致。",
                "核对实际开工记录。",
                ref,
            )
        if op.status == TaskStatus.IN_PROGRESS and op.end <= case.report_snapshot_at:
            add(
                "IN_PROGRESS_STATUS_STALE",
                f"工序 {op.id} 已过计划结束时间，仍标记加工中。",
                "缺少实际剩余加工时间，无法确定后续资源占用。",
                "更新实际报工和剩余加工时间，不要默认设备已经空闲。",
                ref,
            )


def _check_events(case: ValidationCase, add) -> None:
    machine_ids = {item.id for item in case.machines}
    signatures = set()
    for index, event in enumerate(case.failures):
        ref = f"event:{index}"
        if event.machine_id not in machine_ids:
            add(
                "FAILURE_MACHINE_NOT_FOUND",
                f"故障设备 {event.machine_id} 不存在。",
                "无法确定受影响资源。",
                "选择设备清单中的设备。",
                ref,
            )
        if event.received_at < event.started_at:
            add(
                "EVENT_TIME_INVALID",
                f"故障 {event.event_id} 的接收时间早于发生时间。",
                "事件时间不合法。",
                "核对事件发生与接收时间。",
                ref,
            )
        recovery = event.estimated_recovery_at
        if recovery is None:
            add(
                "RECOVERY_TIME_UNKNOWN",
                f"设备 {event.machine_id} 的预计恢复时间尚未确认。",
                "当前只能提示潜在风险，不能生成正式候选。",
                "由现场人员填写预计恢复时间并保存事件。",
                ref,
            )
        elif recovery <= event.started_at:
            add(
                "RECOVERY_TIME_INVALID",
                "预计恢复时间必须晚于故障发生时间。",
                "无法得到有效的故障窗口。",
                "核对预计恢复日期和时间。",
                ref,
            )
        signature = (event.machine_id, event.started_at, recovery)
        if signature in signatures:
            add(
                "DUPLICATE_EVENT",
                f"设备 {event.machine_id} 存在重复故障窗口。",
                "可能重复计算故障影响。",
                "核对并合并重复记录。",
                ref,
            )
        signatures.add(signature)
        for op_index, op in enumerate(case.schedule.operations):
            op_ref = f"operation:{op_index}"
            if op.status == TaskStatus.PLANNED and op.start < event.started_at:
                add(
                    "EVENT_REPORT_STALE",
                    f"故障发生前工序 {op.id} 已到计划开工时间，但快照仍为未开工。",
                    "修改事件时间不会自动推进执行状态。",
                    "提供事件时刻的报工记录，或使用与当前快照一致的试算事件。",
                    ref,
                    op_ref,
                )
            end = (
                recovery
                if recovery and recovery > event.started_at
                else max(op.end, event.started_at + timedelta(minutes=1))
            )
            if op.machine_id == event.machine_id and op.status != TaskStatus.PLANNED:
                if overlaps(op.start, op.end, event.started_at, end):
                    code = (
                        "WIP_POLICY_REQUIRED" if not case.wip_policy else "WIP_POLICY_UNSUPPORTED"
                    )
                    add(
                        code,
                        f"故障涉及已开工或已完成的工序 {op.id}。",
                        "当前排产工具不能移动已开工工序，不能直接生成安全候选。",
                        "确认在制品处置；即使填写规则，也须等执行工具支持后再试算。",
                        ref,
                        op_ref,
                    )
