import { localInput, stamp } from '../../shared/lib/time';
import type { Workbench } from '../../shared/api/contracts';

export interface EventDraft {
  machine_id: string;
  started_at: string;
  recovered_at: string;
  unknown: boolean;
  source: string;
}
export const draftFor = (state: Workbench): EventDraft => ({
  machine_id: state.event.machine_id || state.machines[0]?.id || '',
  started_at: localInput(state.event.started_at),
  recovered_at: localInput(
    state.event.recovered_at ||
      new Date(+new Date(state.event.started_at) + 4 * 3600_000).toISOString(),
  ),
  unknown: state.event.recovered_at === null,
  source: state.event_cancelled ? '产线员工手动录入' : state.event.source,
});
export const draftFingerprint = (draft: EventDraft) =>
  JSON.stringify({ ...draft, recovered_at: draft.unknown ? '' : draft.recovered_at });

export function explainIssue(state: Workbench, issue: string) {
  const op = [...state.baseline.operations]
    .sort((a, b) => b.id.length - a.id.length)
    .find((op) => issue.includes(`${op.id} `));
  const status = op && { planned: '待加工', in_progress: '加工中', completed: '已完成' }[op.status];
  if (issue.startsWith('报工状态过期') && op)
    return `${op.id}（${op.machine_id}），计划 ${stamp(op.start)}—${stamp(op.end)}，当前报工状态为“${status}”。计划开工时间早于本次故障发生时间，但没有对应时点的实际报工信息，无法判断它是尚未开工、正在加工还是已经完成。`;
  if (issue.startsWith('加工中故障') && op)
    return `${op.id}（${op.machine_id}），计划 ${stamp(op.start)}—${stamp(op.end)}，当前报工状态为“${status}”，与故障窗口重叠。需核实实际执行记录；涉及在制品时，先明确续加工、重启或报废等处置条件。`;
  return issue;
}
