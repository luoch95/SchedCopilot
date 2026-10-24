import type { Simulation, Workbench, WorkflowResult } from '../../shared/api/contracts';
import { publishedFault } from '../workbench';

export function FaultProgress({
  state,
  workflow,
  simulation,
  generating = false,
  dirty = false,
  onReview,
  scope = 'plan',
}: {
  state: Workbench;
  workflow: WorkflowResult | null;
  simulation?: Simulation | null;
  generating?: boolean;
  dirty?: boolean;
  onReview?: () => void;
  scope?: 'event' | 'plan';
}) {
  const publication = publishedFault(state);
  const published = !dirty && !generating && !!publication;
  const review = state.fault_review;
  const assessment =
    workflow?.status === 'completed' && !!workflow.results.evaluation?.data?.assessment;
  const currentReview =
    review?.event_revision === state.event_revision &&
    review.baseline_fingerprint === state.baseline.fingerprint &&
    (scope === 'event' ||
      ((!assessment || (review.kind === 'assessment' && review.workflow_id === workflow?.id)) &&
        (!simulation || review.simulation_id === simulation.id)))
      ? review
      : null;
  const analyzed =
    published ||
    (!dirty &&
      !generating &&
      (!!currentReview ||
        assessment ||
        (!!simulation &&
          workflow?.status === 'completed' &&
          simulation.event_revision === state.event_revision &&
          simulation.baseline_fingerprint === state.baseline.fingerprint)));
  const approved = published || (!dirty && !generating && currentReview?.status === 'approved');
  const steps = [
    { label: '故障登记', done: !dirty, detail: dirty ? '修改待保存' : '已保存' },
    {
      label: 'AI 分析方案',
      done: analyzed,
      detail: generating ? '分析中' : analyzed ? '已完成' : '待分析',
    },
    {
      label: '管理者审批',
      done: approved,
      detail: approved
        ? '已批准'
        : currentReview?.status === 'rejected'
          ? '已退回 · 待修改重审'
          : currentReview?.status === 'pending'
            ? '待审批'
            : '待提交',
    },
    {
      label: '计划发布',
      done:
        published ||
        ((scope === 'event' ? currentReview?.kind === 'assessment' : assessment) && approved),
      detail:
        (scope === 'event' ? currentReview?.kind === 'assessment' : assessment) && !published
          ? '评估结论无需发布排产'
          : published
            ? `已发布 V${publication?.published_version ?? state.baseline.version}`
            : approved
              ? '已流转排产员 · 待发布'
              : '待审批通过',
    },
  ];
  const active = steps.findIndex((step) => !step.done);
  return (
    <>
      <ol className="fault-progress" aria-label="故障处理流程">
        {steps.map((step, index) => (
          <li
            key={step.label}
            className={step.done ? 'is-complete' : ''}
            aria-current={index === active ? 'step' : undefined}
            aria-label={`${step.label}：${step.detail}`}
          >
            <span className="fault-progress-node" aria-hidden="true">
              {step.done ? '✓' : index + 1}
            </span>
            <span className="fault-progress-copy">
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </span>
          </li>
        ))}
      </ol>
      {onReview && !dirty && !generating && (currentReview || (published && review)) && (
        <button className="fault-review-link" onClick={onReview}>
          审批详情
        </button>
      )}
    </>
  );
}
