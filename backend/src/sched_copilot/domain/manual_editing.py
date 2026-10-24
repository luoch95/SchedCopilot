"""Manual edits respect the execution snapshot, independent of the wall clock."""

from .errors import RuleViolation


def check_manual_time_boundary(before, after, snapshot_time):
    originals = {op.id: op for op in before.operations}
    for op in after.operations:
        original = originals.get(op.id)
        if original is None or op == original:
            continue
        if original.start < snapshot_time:
            raise RuleViolation(
                f"工序 {op.id} 开始于执行快照时间之前，整道工序禁止人工调整；"
                "若仍标记未开工，请核实报工状态"
            )
        if op.start < snapshot_time:
            raise RuleViolation(f"工序 {op.id} 不能移入执行快照时间之前")
