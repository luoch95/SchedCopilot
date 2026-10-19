"""Calendar and setup constraints for an explicitly supplied production snapshot."""

from dataclasses import dataclass
from datetime import datetime, timedelta

from .errors import RuleViolation
from .models import MachineFailure, Operation, Schedule
from .scheduling import overlaps


@dataclass(frozen=True)
class ProductionResources:
    source: str
    shifts: dict[str, tuple[tuple[datetime, datetime], ...]]
    operation_molds: dict[str, str]
    initial_molds: dict[str, str]
    changeover_minutes: int

    def configuration_errors(self, schedule, machines):
        ids = {m.id for m in machines}
        errors = []
        if set(self.shifts) != ids or set(self.initial_molds) != ids:
            errors.append("班次或初始装模未覆盖全部设备")
        if set(self.operation_molds) != {o.id for o in schedule.operations}:
            errors.append("实体模具分配不完整")
        for windows in self.shifts.values():
            if not windows or any(b <= a for a, b in windows):
                errors.append("班次时间无效")
            if any(b > c for (_, b), (c, _) in zip(windows, windows[1:])):
                errors.append("班次存在重叠或顺序错误")
        if self.changeover_minutes <= 0:
            errors.append("换型规则必须提供正数分钟")
        return errors

    def setup(self, before, after):
        return self.changeover_minutes if before != after else 0

    def windows(self, machine_id):
        merged = []
        for start, end in self.shifts[machine_id]:
            if merged and merged[-1][1] == start:
                merged[-1] = (merged[-1][0], end)
            else:
                merged.append((start, end))
        return merged

    def place(self, op: Operation, machine_id: str, earliest: datetime, placed, failure):
        machine_ops = [o for o in placed.values() if o.machine_id == machine_id]
        last = max(machine_ops, key=lambda o: o.end, default=None)
        mold = self.operation_molds[op.id]
        previous = self.operation_molds[last.id] if last else self.initial_molds[machine_id]
        setup = self.setup(previous, mold)
        resource_end = max(
            (o.end for o in placed.values() if self.operation_molds[o.id] == mold),
            default=earliest - timedelta(minutes=setup),
        )
        earliest = max(earliest, resource_end + timedelta(minutes=setup))
        if last:
            earliest = max(earliest, last.end + timedelta(minutes=setup))
        for left, right in self.windows(machine_id):
            start = max(earliest, left + timedelta(minutes=setup))
            if machine_id == failure.machine_id and overlaps(
                start - timedelta(minutes=setup),
                start + timedelta(minutes=op.duration_minutes),
                failure.started_at,
                failure.recovered_at,
            ):
                start = max(start, failure.recovered_at + timedelta(minutes=setup))
            if start + timedelta(minutes=op.duration_minutes) <= right:
                return start
        raise RuleViolation("班次范围内没有可用时段")

    def check(self, schedule: Schedule, failure: MachineFailure):
        errors = []
        for machine_id in self.shifts:
            previous = self.initial_molds[machine_id]
            previous_end = None
            for op in sorted(
                (o for o in schedule.operations if o.machine_id == machine_id),
                key=lambda o: (o.start, o.id),
            ):
                mold = self.operation_molds[op.id]
                setup = self.setup(previous, mold)
                setup_start = op.start - timedelta(minutes=setup)
                if previous_end and setup_start < previous_end:
                    errors.append("换型准备时间与前道加工冲突")
                if not any(
                    left <= setup_start and op.end <= right
                    for left, right in self.windows(machine_id)
                ):
                    errors.append("加工或换型超出班次")
                if machine_id == failure.machine_id and overlaps(
                    setup_start, op.end, failure.started_at, failure.recovered_at
                ):
                    errors.append("加工或换型与故障窗口冲突")
                previous, previous_end = mold, op.end
        for mold in set(self.operation_molds.values()):
            operations = sorted(
                (o for o in schedule.operations if self.operation_molds[o.id] == mold),
                key=lambda o: o.start,
            )
            if any(a.end > b.start for a, b in zip(operations, operations[1:])):
                errors.append("实体模具同时被多道工序占用")
        return errors

    def placement_causes(self, op, machine_id, earliest, placed, failure):
        """Explain resource bounds using the same already-placed snapshot as placement."""
        last = max(
            (o for o in placed.values() if o.machine_id == machine_id),
            key=lambda o: o.end,
            default=None,
        )
        mold = self.operation_molds[op.id]
        previous = self.operation_molds[last.id] if last else self.initial_molds[machine_id]
        setup = self.setup(previous, mold)
        causes = []
        lower = earliest
        if last:
            lower = max(lower, last.end + timedelta(minutes=setup))
            if last.end + timedelta(minutes=setup) > earliest:
                causes.append(last.id)
                if setup:
                    causes.append(f"换型:{machine_id}:{setup}分钟")
        for other in placed.values():
            if self.operation_molds[other.id] == mold:
                lower = max(lower, other.end + timedelta(minutes=setup))
                if other.end + timedelta(minutes=setup) > earliest:
                    causes.append(other.id)
                    if other.machine_id != machine_id:
                        causes.append(f"模具占用:{mold}")
        if machine_id == failure.machine_id and overlaps(
            lower - timedelta(minutes=setup),
            lower + timedelta(minutes=op.duration_minutes),
            failure.started_at,
            failure.recovered_at,
        ):
            causes.append(f"故障:{machine_id}")
            if setup:
                causes.append(f"恢复后换型:{machine_id}:{setup}分钟")
            lower = max(lower, failure.recovered_at + timedelta(minutes=setup))
        if not any(
            left <= lower - timedelta(minutes=setup)
            and lower + timedelta(minutes=op.duration_minutes) <= right
            for left, right in self.windows(machine_id)
        ):
            causes.append(f"班次:{machine_id}")
        return tuple(dict.fromkeys(causes))

    def totals(self, schedule):
        result = {}
        for machine_id in self.shifts:
            previous = self.initial_molds[machine_id]
            count = minutes = 0
            for op in sorted(
                (o for o in schedule.operations if o.machine_id == machine_id),
                key=lambda o: (o.start, o.id),
            ):
                mold = self.operation_molds[op.id]
                duration = self.setup(previous, mold)
                count += int(duration > 0)
                minutes += duration
                previous = mold
            result[machine_id] = (count, minutes)
        return result

    def evaluate(self, baseline, candidate, failure):
        old, new = self.totals(baseline), self.totals(candidate)
        loads = {}
        for machine_id, windows in self.shifts.items():
            available = sum((end - start).total_seconds() / 60 for start, end in windows)
            if machine_id == failure.machine_id:
                available -= sum(
                    max(
                        0,
                        (
                            min(end, failure.recovered_at) - max(start, failure.started_at)
                        ).total_seconds()
                        / 60,
                    )
                    for start, end in windows
                )
            processing = sum(
                o.duration_minutes for o in candidate.operations if o.machine_id == machine_id
            )
            loads[machine_id] = {
                "changeovers": new[machine_id][0],
                "available_minutes": available,
                "setup_minutes": new[machine_id][1],
                "utilization": (processing + new[machine_id][1]) / available
                if available > 0
                else None,
            }
        return {
            "baseline_changeovers": sum(c for c, _ in old.values()),
            "changeovers": sum(c for c, _ in new.values()),
            "baseline_changeover_minutes": sum(m for _, m in old.values()),
            "changeover_minutes": sum(m for _, m in new.values()),
            "extra_changeovers": max(
                0, sum(c for c, _ in new.values()) - sum(c for c, _ in old.values())
            ),
            "extra_changeover_minutes": max(
                0, sum(m for _, m in new.values()) - sum(m for _, m in old.values())
            ),
        }, loads
