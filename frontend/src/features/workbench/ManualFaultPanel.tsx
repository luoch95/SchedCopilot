import { useState } from 'react';
import type { ManualFaultDraft, Workbench } from '../../shared/api/contracts';
import Gantt from '../../shared/ui/Gantt';
import { WriteButton } from '../../shared/ui/WriteButton';
import { ContributionReport } from '../../shared/ui/ContributionReport';
import { useDemoAccess } from '../../shared/lib/demoAccess';

export function ManualFaultPanel({
  draft,
  state,
  range,
  busy,
  disabled,
  onMove,
  onConfirm,
}: {
  draft: ManualFaultDraft;
  state: Workbench;
  range: [number, number];
  busy: string;
  disabled: boolean;
  onMove: (id: string, machine: string, start: string, reason: string) => unknown;
  onConfirm: () => unknown;
}) {
  const [reason, setReason] = useState('');
  const { readOnly } = useDemoAccess();
  const locked = disabled || !!busy || readOnly;
  const times = draft.schedule.operations.flatMap((op) => [
    Date.parse(op.start),
    Date.parse(op.end),
  ]);
  const editRange: [number, number] = [Math.min(range[0], ...times), Math.max(range[1], ...times)];
  return (
    <section className="fault-stage-card manual-fault-panel" aria-label="人工调整草案">
      <div className="fault-stage-card-heading">
        <h3>人工调整草案 · R{draft.revision}</h3>
        <span>{draft.status === 'editing' ? '人工调整中' : '报告已生成，待提交审批'}</span>
      </div>
      <p className="hint">
        拖拽尚未开工的色块调整设备与时间（5
        分钟对齐）。聚焦色块后可用方向键调整；每次调整自动保存，并使旧报告和审批失效。
      </p>
      <label>
        调整原因（可选，将记录在报告中）
        <input
          value={reason}
          maxLength={2000}
          disabled={locked}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <Gantt
        schedule={draft.schedule}
        baseline={draft.origin}
        failure={state.event}
        machines={state.machines}
        range={editRange}
        onMove={locked ? undefined : (id, machine, start) => onMove(id, machine, start, reason)}
      />
      {!!draft.issues.length && (
        <div role="alert" className="message warning">
          {draft.issues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
          <p>草案已保存，请修正冲突后再确认。</p>
        </div>
      )}
      <div className="inline-actions">
        <WriteButton
          className="primary"
          disabled={locked || draft.status === 'ready_for_review'}
          onClick={() => onConfirm()}
        >
          {busy === '评估人工草案'
            ? '正在评估并生成报告…'
            : draft.status === 'ready_for_review'
              ? '报告已生成'
              : '确认调整并生成草案报告'}
        </WriteButton>
      </div>
      <ContributionReport report={draft.report} />
    </section>
  );
}
