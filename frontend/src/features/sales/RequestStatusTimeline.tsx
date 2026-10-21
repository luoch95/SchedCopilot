import type { InsertionRequestRecord } from '../../shared/api/contracts';
import { statusLabel } from '../../shared/lib/status';
import { localInput } from '../../shared/lib/time';

const roles: Record<string, string> = {
  sales: '业务员 (Sales)',
  planner: '排产计划员 (Planner)',
  leader: '管理者 (Leader)',
  system: '系统',
};
function action(entry: NonNullable<InsertionRequestRecord['status_history']>[number]) {
  if (entry.from_status === 'draft' && entry.to_status === 'pending_approval') return '提交了申请';
  if (entry.to_status === 'approved') return '批准了插单申请';
  if (entry.to_status === 'rejected') return '驳回了插单申请';
  if (entry.to_status === 'published') return '复核并发布了排产计划';
  if (entry.to_status === 'pending_approval') return '发起了重新审批';
  return '更新了申请';
}
export function RequestStatusTimeline({
  history,
}: {
  history: NonNullable<InsertionRequestRecord['status_history']>;
}) {
  return (
    <ol className="request-timeline" aria-label="申请流转时间轴">
      {history.map((entry, index) => (
        <li
          key={index}
          className={entry.to_status === 'rejected' ? 'request-timeline-rejected' : undefined}
        >
          <span className="request-timeline-dot" aria-hidden="true" />
          <div>
            <time dateTime={entry.created_at}>
              {localInput(entry.created_at).replace('T', ' ').replaceAll('-', '/')}
            </time>
            {' — '}
            {roles[entry.operator_role] ?? '操作人'} {action(entry)}，状态变更为
            <strong className="request-timeline-status">【{statusLabel(entry.to_status)}】</strong>
            。
          </div>
          {entry.comment && <p className="request-timeline-comment">备注：{entry.comment}</p>}
        </li>
      ))}
    </ol>
  );
}
