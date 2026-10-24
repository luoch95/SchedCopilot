import type { ManualFaultDraft, Workbench } from '../../shared/api/contracts';
import Gantt from '../../shared/ui/Gantt';
import { WriteButton } from '../../shared/ui/WriteButton';
import { useDemoAccess } from '../../shared/lib/demoAccess';
import { Modal } from '../../shared/ui/Modal';
import { stamp } from '../../shared/lib/time';
import type { ReactNode } from 'react';
import { DecisionPageHeader } from '../../shared/ui/DecisionPageHeader';

export function ManualFaultPanel({
  draft,
  state,
  range,
  busy,
  disabled,
  sourceLabel,
  onMove,
  onConfirm,
  onCancel,
  breadcrumb,
}: {
  draft: ManualFaultDraft;
  state: Workbench;
  range: [number, number];
  busy: string;
  disabled: boolean;
  sourceLabel: string;
  onMove: (id: string, machine: string, start: string, reason: string) => unknown;
  onConfirm: () => unknown;
  onCancel: () => void;
  breadcrumb?: ReactNode;
}) {
  const { readOnly } = useDemoAccess();
  const locked = disabled || !!busy || readOnly;
  const times = draft.schedule.operations.flatMap((op) => [
    Date.parse(op.start),
    Date.parse(op.end),
  ]);
  const traces =
    state.plan_publication?.version === state.baseline.version
      ? (state.plan_publication.fault_traces ?? [])
      : [];
  const faults = [
    ...traces.map((trace) => ({
      failure: trace.failure,
      faultTrace: { version: trace.version, affectedOperations: trace.affected_operations },
    })),
    { failure: state.event },
  ];
  const futureFaultTimes = faults.flatMap(({ failure }) => {
    const start = Date.parse(failure.started_at);
    const end = failure.recovered_at ? Date.parse(failure.recovered_at) : range[1];
    return end > Date.parse(state.snapshot_time)
      ? [Math.max(start, Date.parse(state.snapshot_time)), end]
      : [];
  });
  const editRange: [number, number] = [
    Math.min(range[0], ...times, ...futureFaultTimes, Date.parse(state.snapshot_time)),
    Math.max(range[1], ...times, ...futureFaultTimes, Date.parse(state.snapshot_time)),
  ];
  return (
    <Modal
      title="人工调整排产方案"
      fullScreen
      busy={locked}
      onClose={onCancel}
      heading={(titleId) => (
        <DecisionPageHeader
          title="人工调整排产方案"
          titleId={titleId}
          breadcrumb={breadcrumb}
          description={`编辑起点：${sourceLabel}。调整完成后点击 AI 评估方案，返回决策页查看完整评估。`}
          actions={
            <button className="fault-header-back" disabled={locked} onClick={onCancel}>
              ← 选择编辑起点
            </button>
          }
        />
      )}
    >
      <section className="manual-fault-panel" aria-label="人工调整草案">
        <div className="fault-stage-card-heading">
          <h3>人工调整草案 · R{draft.revision}</h3>
        </div>
        <p className="manual-source-label">
          <strong>编辑起点：{sourceLabel}</strong>
        </p>
        <p className="hint">
          拖拽尚未开工的色块调整设备与时间（5
          分钟对齐）。聚焦色块后可用方向键调整。取消将丢弃本次修改，原 AI 方案保留。
        </p>
        <p className="hint">移动工序不会自动调整后续工序；需要提前的后续工序请一起调整。</p>
        <div className="manual-timeline-key">
          <strong>执行快照时间：{stamp(state.snapshot_time)}</strong>
          <span className="manual-key-locked">过去区域锁定</span>
          <span className="manual-key-editable">未来未开工工序可编辑</span>
          <span className="manual-key-published">已发布停机</span>
          <span className="manual-key-current">本次故障</span>
        </div>
        <p className="hint">
          分界线前及跨越分界线的工序整块锁定，已开工、已完工工序不可调整。停机留痕仅显示未来部分。
        </p>
        <Gantt
          tone="green"
          schedule={{
            ...draft.schedule,
            operations: draft.schedule.operations.map((op) => {
              const original = state.baseline.operations.find((item) => item.id === op.id);
              return {
                ...op,
                display_name: original?.display_name ?? op.display_name,
                order_display_name: original?.order_display_name ?? op.order_display_name,
              };
            }),
          }}
          baseline={draft.origin}
          failure={state.event}
          faults={faults}
          editBoundary={state.snapshot_time}
          machines={state.machines}
          range={editRange}
          onMove={locked ? undefined : (id, machine, start) => onMove(id, machine, start, '')}
        />
        <details className="manual-fault-records">
          <summary>停机记录与来源</summary>
          <ul>
            {faults
              .filter(({ failure }) =>
                failure.recovered_at
                  ? Date.parse(failure.recovered_at) > Date.parse(state.snapshot_time)
                  : true,
              )
              .map((item, index) => (
                <li key={index}>
                  {'faultTrace' in item ? `已发布停机 · V${item.faultTrace.version}` : '本次故障'}
                  {' · '}
                  {item.failure.machine_id} · {stamp(item.failure.started_at)} →{' '}
                  {item.failure.recovered_at ? stamp(item.failure.recovered_at) : '恢复未知'}
                  {' · 来源：'}
                  {item.failure.source}
                </li>
              ))}
          </ul>
        </details>
        {!!draft.issues.length && (
          <div role="alert" className="message warning">
            {draft.issues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
            <p>请调整冲突工序后重新评估。</p>
          </div>
        )}
        <footer className="inline-actions manual-editor-actions">
          <button disabled={locked} onClick={onCancel}>
            取消
          </button>
          <WriteButton className="primary" disabled={locked} onClick={() => onConfirm()}>
            AI 评估方案
          </WriteButton>
        </footer>
      </section>
    </Modal>
  );
}
