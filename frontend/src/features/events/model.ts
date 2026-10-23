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
  machine_id: state.event.machine_id,
  started_at: localInput(state.event.started_at),
  recovered_at: localInput(
    state.event.recovered_at ||
      new Date(+new Date(state.event.started_at) + 4 * 3600_000).toISOString(),
  ),
  unknown: state.event.recovered_at === null,
  source: state.event.source,
});
export const draftFingerprint = (draft: EventDraft) =>
  JSON.stringify({ ...draft, recovered_at: draft.unknown ? '' : draft.recovered_at });

export function explainIssue(state: Workbench, issue: string) {
  const originalById = new Map(state.baseline.operations.map((op) => [op.id, op]));
  const id = issue.match(/O\d+-OP\d+/)?.[0];
  const op = id && originalById.get(id);
  if (issue.startsWith('报工状态过期') && op)
    return `${id} 原计划在 ${stamp(op.start)} 开工，但13:00快照仍标记为待加工。故障时间晚于这个时点，缺少新的报工状态。请使用13:00模拟，或恢复可试算事件。`;
  if (issue.startsWith('加工中故障') && op)
    return `${op.machine_id} 的故障窗口覆盖了 ${id}（${stamp(op.start)}—${stamp(op.end)}），但执行记录显示它已完成或已开工。请调整故障时间，避免与执行记录冲突。`;
  return issue;
}
