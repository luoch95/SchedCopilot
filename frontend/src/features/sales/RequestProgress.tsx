import type { InsertionRequestRecord } from '../../shared/api/contracts';

export function RequestProgress({ record }: { record: InsertionRequestRecord }) {
  const published = record.status === 'published';
  const rejected = record.status === 'rejected';
  const stale = !!record.assessment_stale && !published && !rejected;
  const assessed = !!record.assessment;
  const current = published
    ? 4
    : rejected
      ? 2
      : stale || !assessed
        ? 0
        : record.status === 'draft'
          ? 1
          : record.status === 'approved'
            ? 3
            : 2;
  const labels = ['试排评估', '提交管理者审批', '管理者审批', '排产员复核发布'];
  return (
    <div>
      <ol className="request-progress" aria-label="申请审批流程">
        {labels.map((label, index) => {
          const state =
            rejected && index === 0 && !assessed
              ? 'waiting'
              : rejected && index === 2
                ? 'rejected'
                : index < current
                  ? 'done'
                  : index === current
                    ? 'current'
                    : 'waiting';
          const description = {
            done: '已完成',
            current: '待处理',
            waiting: '未到达',
            rejected: '已驳回',
          }[state];
          return (
            <li
              key={label}
              className={`request-progress-${state}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span aria-hidden="true">
                {state === 'done' ? '✓' : state === 'rejected' ? '×' : index + 1}
              </span>
              <div>
                {label}
                <small>{description}</small>
              </div>
            </li>
          );
        })}
      </ol>
      {stale && <p className="request-progress-notice">试排结果已过期，需重新试排并重新审批。</p>}
      {rejected && <p className="request-progress-notice">申请已驳回，流程结束。</p>}
    </div>
  );
}
