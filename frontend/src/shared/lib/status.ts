const statuses: Record<string, { label: string; tone: string }> = {
  completed: { label: '已完工', tone: 'neutral' },
  planned: { label: '计划中', tone: 'blue' },
  in_progress: { label: '加工中', tone: 'blue' },
  draft: { label: '草稿', tone: 'neutral' },
  pending_approval: { label: '待审批', tone: 'amber' },
  pending: { label: '待处理', tone: 'amber' },
  approved: { label: '已批准', tone: 'green' },
  rejected: { label: '已驳回', tone: 'red' },
  published: { label: '已发布', tone: 'green' },
};
export function statusPresentation(status: string) {
  return statuses[status] ?? { label: '状态待确认', tone: 'neutral' };
}
export function statusLabel(status: string) {
  return statusPresentation(status).label;
}
