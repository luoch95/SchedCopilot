import { useState } from 'react';
import type { InsertionProgressEvent, InsertionStage } from '../../shared/api/contracts';
import { workbenchApi } from '../workbench';

const stages: { agent: InsertionStage; label: string }[] = [
  { agent: 'validation', label: '数据校验' },
  { agent: 'scheduling', label: '排产试算' },
  { agent: 'evaluation', label: '方案评估' },
  { agent: 'explanation', label: '结果解释' },
  { agent: 'saving', label: '保存评估结果' },
];
type Step = {
  status: 'waiting' | 'running' | 'completed' | 'failed' | 'interrupted';
  mode?: string;
};
export interface InsertionProgressState {
  steps: Partial<Record<InsertionStage, Step>>;
  status: 'preparing' | 'running' | 'completed' | 'interrupted';
}

export function useInsertionProgress() {
  const [progress, setProgress] = useState<InsertionProgressState | null>(null);
  function receive(event: InsertionProgressEvent) {
    if (!stages.some((stage) => stage.agent === event.agent)) return;
    const status = {
      insertion_stage_started: 'running',
      insertion_stage_completed: 'completed',
      insertion_stage_failed: 'failed',
    } as const;
    setProgress((previous) => ({
      status: 'running',
      steps: {
        ...previous?.steps,
        [event.agent]: { status: status[event.type], mode: event.mode },
      },
    }));
  }
  return {
    progress,
    reset: () => setProgress(null),
    start: () => setProgress({ steps: {}, status: 'preparing' }),
    fail: () =>
      setProgress((previous) =>
        previous
          ? {
              status: 'interrupted',
              steps: Object.fromEntries(
                Object.entries(previous.steps).map(([agent, step]) => [
                  agent,
                  step.status === 'running' ? { ...step, status: 'interrupted' } : step,
                ]),
              ),
            }
          : null,
      ),
    run: async (id: string) => {
      const result = await workbenchApi.assessRequestStream(id, receive);
      setProgress((previous) => {
        const steps = { ...previous?.steps };
        // Older JSON responses have no live events; only show recorded role outcomes.
        for (const step of result.workflow?.trace ?? []) {
          if (stages.some((stage) => stage.agent === step.agent))
            steps[step.agent as InsertionStage] = {
              status: step.status === 'success' ? 'completed' : 'failed',
              mode: step.mode,
            };
        }
        steps.saving = { status: 'completed' };
        return { steps, status: 'completed' };
      });
      return result;
    },
  };
}

export function InsertionProgress({ progress }: { progress: InsertionProgressState | null }) {
  if (!progress) return null;
  const labels = {
    waiting: '待开始',
    running: '进行中',
    completed: '已完成',
    failed: '失败',
    interrupted: '已中断，结果未确认',
  };
  const active = stages.find((stage) => progress.steps[stage.agent]?.status === 'running');
  return (
    <section className="insertion-progress" aria-label="插单评估链路" aria-live="polite">
      <h3>插单评估链路</h3>
      <p role="status">
        {progress.status === 'preparing'
          ? '正在保存草稿，等待评估开始…'
          : progress.status === 'completed'
            ? '评估结果已保存，可查看摘要后提交审批。'
            : progress.status === 'interrupted'
              ? '评估未完成，请查看错误信息；后续步骤未继续。'
              : active
                ? `正在${active.label}…`
                : '正在衔接下一步骤…'}
      </p>
      <ol className="insertion-progress-steps">
        {stages.map(({ agent, label }, index) => {
          const step = progress.steps[agent];
          const status = step?.status ?? 'waiting';
          return (
            <li
              key={agent}
              data-status={status}
              aria-current={status === 'running' ? 'step' : undefined}
            >
              <span aria-hidden="true">{status === 'completed' ? '✓' : index + 1}</span>
              <div>
                <strong>{label}</strong>
                <small>{labels[status]}</small>
                {step?.mode && (
                  <small>
                    {step.mode === 'live'
                      ? '模型辅助'
                      : step.mode === 'fallback'
                        ? '已降级为规则结果'
                        : '规则计算'}
                  </small>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
