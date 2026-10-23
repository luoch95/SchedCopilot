import type { InsertionRequestRecord, Schedule, Workbench } from '../../shared/api/contracts';
import Gantt from '../../shared/ui/Gantt';
import { GanttSelectionProvider } from '../../shared/ui/GanttSelection';
import { PlanVersionTag } from '../plan';
import { operationLabels } from './presentation';

/** Compare the selected request's actual trial with its formal baseline. */
export function PlannerInsertionComparison({
  record,
  state,
}: {
  record: InsertionRequestRecord;
  state: Workbench;
}) {
  const result = record.assessment;
  if (!result) return <p className="message info">该申请尚未试排，请先点击“评估插单”。</p>;
  const matches =
    result.baseline_fingerprint === state.baseline.fingerprint &&
    result.event_revision === state.event_revision &&
    !record.assessment_stale;
  const schedule: Schedule = {
    version: result.baseline_version,
    fingerprint: result.assessment_id ?? '',
    operations: result.details.operations.map((op) => ({
      ...operationLabels(result, op, record.request_no),
      id: op.operation_id,
      order_id: op.order_id,
      machine_id: op.machine_id,
      start: op.start,
      end: op.end,
      status: op.status as Schedule['operations'][number]['status'],
    })),
  };
  const operations = [...(matches ? state.baseline.operations : []), ...schedule.operations];
  const start = Math.min(
    ...operations.map((op) => +new Date(op.start)),
    +new Date(state.event.started_at),
  );
  const end = Math.max(
    ...operations.map((op) => +new Date(op.end)),
    +new Date(state.event.recovered_at ?? state.event.started_at),
  );
  const range: [number, number] = [start, Math.max(start + 3600000, end)];
  return (
    <GanttSelectionProvider>
      <section className="section" aria-label="插单方案比较">
        <div className="section-heading">
          <h3>方案比较</h3>
          <span className="tag">正式基线 / 本次插单试排</span>
        </div>
        {matches ? (
          <div className="insertion-plan-grid">
            <article>
              <h4>
                执行计划{' '}
                <PlanVersionTag
                  version={state.baseline.version}
                  publication={state.plan_publication}
                />
              </h4>
              <Gantt
                schedule={state.baseline}
                failure={state.event}
                machines={state.machines}
                range={range}
              />
            </article>
            <article>
              <h4>
                插单试排 · {record.product_id} / {record.quantity}件
              </h4>
              <Gantt
                schedule={schedule}
                baseline={state.baseline}
                failure={state.event}
                machines={state.machines}
                range={range}
              />
            </article>
          </div>
        ) : (
          <p className="message warning">
            {record.status === 'published'
              ? '该申请已发布，试排结果作为历史记录保留。当前执行计划已更新，不再展示旧基线对照。'
              : '执行计划、故障或生产资源已变化，无法使用当前数据还原这份试排的对照。请重新试排后比较。'}
          </p>
        )}
      </section>
    </GanttSelectionProvider>
  );
}
