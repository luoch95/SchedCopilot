import type { FaultAnalysis, FaultReview, Simulation } from '../api/contracts';

export function publishedVariant(archive: FaultAnalysis | null | undefined): 'ai' | 'manual' {
  return (
    archive?.selected_variant ??
    (archive?.simulation?.candidates[0]?.id.startsWith('manual:') ? 'manual' : 'ai')
  );
}

export function faultVariant(archive: FaultAnalysis | null | undefined, view: 'ai' | 'manual') {
  return archive?.variants?.[view] ?? (view === publishedVariant(archive) ? archive : null);
}

export function faultPlanStatus(
  simulation: Simulation | null | undefined,
  review: FaultReview | null | undefined,
  archive?: FaultAnalysis | null,
  workflowId?: string,
) {
  const bound =
    review &&
    ((simulation &&
      review.simulation_id === simulation.id &&
      review.event_revision === simulation.event_revision &&
      review.baseline_fingerprint === simulation.baseline_fingerprint) ||
      (!simulation && review.kind === 'assessment' && review.workflow_id === workflowId))
      ? review
      : archive?.decisions;
  const status = bound?.status;
  const labels: Record<string, string> = {
    pending: '待审批',
    approved: '已批准 · 待发布',
    rejected: '已退回',
    superseded: '审批已失效',
    published: '已发布',
  };
  if (review?.kind === 'assessment' && review.workflow_id === workflowId && status === 'approved')
    return '结论已批准';
  return status ? (labels[status] ?? '未提交审批') : '未提交审批';
}
