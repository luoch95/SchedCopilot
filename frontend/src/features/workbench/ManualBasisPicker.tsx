import type { ReactNode } from 'react';
import { DecisionPageHeader } from '../../shared/ui/DecisionPageHeader';
import type { Simulation, Workbench, WorkflowResult } from '../../shared/api/contracts';
import { candidateTitle } from '../../shared/lib/candidatePresentation';
import { Modal } from '../../shared/ui/Modal';
import Gantt from '../../shared/ui/Gantt';
import { WriteButton } from '../../shared/ui/WriteButton';

export function ManualBasisPicker({
  state,
  simulation,
  workflow,
  range,
  replacing,
  disabled,
  onChoose,
  onCancel,
  breadcrumb,
  selected,
  onSelected,
  acknowledged,
  onAcknowledged,
}: {
  state: Workbench;
  simulation: Simulation | null;
  workflow: WorkflowResult | null;
  range: [number, number];
  replacing: boolean;
  disabled: boolean;
  onChoose: (basis: string | null) => void;
  onCancel: () => void;
  breadcrumb?: ReactNode;
  selected: string | null | undefined;
  onSelected: (id: string | null) => void;
  acknowledged: boolean;
  onAcknowledged: (value: boolean) => void;
}) {
  const baselineImpacts = simulation?.candidates[0]?.order_impacts;
  const choices = [
    {
      id: null,
      label: `当前执行计划 V${state.baseline.version}`,
      schedule: state.baseline,
      metrics: baselineImpacts?.length
        ? {
            total_lateness_minutes: baselineImpacts.reduce(
              (sum, impact) => sum + impact['原延期(分钟)'],
              0,
            ),
            moved_operations: 0,
          }
        : null,
    },
    ...(simulation?.candidates ?? []).map((candidate) => ({
      ...candidate,
      label: candidateTitle(candidate, workflow),
    })),
  ];
  const preview = choices.find((choice) => choice.id === selected);
  const previewTimes =
    preview?.schedule.operations.flatMap((op) => [Date.parse(op.start), Date.parse(op.end)]) ?? [];
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
  const faultTimes = faults.flatMap(({ failure }) => [
    Date.parse(failure.started_at),
    ...(failure.recovered_at ? [Date.parse(failure.recovered_at)] : []),
  ]);
  return (
    <Modal
      title="选择编辑起点"
      fullScreen
      onClose={onCancel}
      heading={(titleId) => (
        <DecisionPageHeader
          title="选择编辑起点"
          titleId={titleId}
          breadcrumb={breadcrumb}
          description="选择在哪个甘特图的基础上手动调整。AI 方案已包含故障后的安排；当前执行计划可能仍有故障冲突。"
          actions={
            <button className="fault-header-back" onClick={onCancel}>
              ← 故障影响与方案决策
            </button>
          }
        />
      )}
    >
      <fieldset className="manual-basis-options">
        <legend>编辑起点（必选）</legend>
        {choices.map((choice) => (
          <label
            key={choice.id ?? 'baseline'}
            className={selected === choice.id ? 'is-selected' : ''}
          >
            <input
              type="radio"
              name="manual-basis"
              checked={selected === choice.id}
              disabled={disabled}
              onChange={() => onSelected(choice.id)}
            />
            <strong>{choice.label}</strong>
            <span>
              {choice.metrics
                ? `总延期 ${choice.metrics.total_lateness_minutes} 分钟 · 相对执行计划调整 ${choice.metrics.moved_operations} 道工序`
                : '当前已发布的设备与时间安排；尚未处理本次故障'}
            </span>
          </label>
        ))}
      </fieldset>
      {preview && (
        <section aria-label="编辑起点预览">
          <h3>{preview.label} · 只读预览</h3>
          <Gantt
            schedule={preview.schedule}
            failure={state.event}
            faults={faults}
            machines={state.machines}
            range={[
              Math.min(range[0], ...previewTimes, ...faultTimes),
              Math.max(range[1], ...previewTimes, ...faultTimes),
            ]}
            tone="green"
          />
        </section>
      )}
      {replacing && (
        <label className="manual-replace-confirm">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => onAcknowledged(event.target.checked)}
          />
          <span>
            我确认重新选择编辑起点；新方案评估后将替换当前人工方案。取消编辑会保留原人工方案。
          </span>
        </label>
      )}
      <footer className="inline-actions manual-editor-actions">
        <button onClick={onCancel}>取消</button>
        <WriteButton
          className="primary"
          disabled={disabled || selected === undefined || (replacing && !acknowledged)}
          onClick={() => {
            if (selected !== undefined) onChoose(selected);
          }}
        >
          基于所选方案编辑
        </WriteButton>
      </footer>
    </Modal>
  );
}
