import type { Simulation, Workbench, WorkflowResult } from '../../shared/api/contracts';
import type { DateRange } from '../../shared/lib/dateRange';
import {
  faultBusinessLabel,
  resolveFaultIdentity,
  visibleFaultEvents,
} from '../../shared/lib/visibleFaultEvents';
import { planReport } from '../../shared/lib/planReport';
import { stamp } from '../../shared/lib/time';
import { AiAnalysisButton } from '../../shared/ui/AiAnalysisButton';
import { PublishedFaultCard } from '../../shared/ui/PublishedFaultCard';
import { FaultProgress } from '../analysis';
import { publishedFaultSummary } from '../workbench';

export type FaultEvent = NonNullable<Workbench['event_history']>[number];

export function LeaderFaultAlerts({
  state,
  workflow,
  simulation,
  range,
  onAnalysis,
  onReview,
  onHistory,
}: {
  state: Workbench;
  workflow: WorkflowResult | null;
  simulation: Simulation | null;
  range: DateRange;
  onAnalysis: () => void;
  onReview: () => void;
  onHistory: (event: FaultEvent) => void;
}) {
  const events = visibleFaultEvents(state, range);
  const publication = publishedFaultSummary(state);
  const candidate = publication?.simulation?.candidates.find(
    (item) =>
      item.id === (publication.selected_candidate_id ?? publication.decisions?.candidate_id),
  );
  const reviewed = state.fault_review?.analysis?.simulation?.candidates.find(
    (item) => item.id === state.fault_review?.candidate_id,
  );
  const summary = planReport(reviewed?.order_impacts);
  return (
    <>
      {events.map((event) => {
        const current = event.revision === state.event_revision;
        const trace = state.plan_publication?.fault_traces?.find(
          (item) => item.event_revision === event.revision,
        );
        if (current && publication)
          return (
            <PublishedFaultCard
              key={event.revision}
              failure={event}

              version={publication.published_version ?? trace?.version}
              candidateLabel={
                candidate
                  ? publication.selected_variant === 'manual' || candidate.id.startsWith('manual:')
                    ? '人工调整方案'
                    : '原 AI 方案'
                  : undefined
              }
              metrics={candidate?.metrics ?? trace?.metrics}
              orderImpacts={candidate?.order_impacts}
              label="已登记设备故障"
              onOpen={onAnalysis}
              onReview={state.fault_review ? onReview : undefined}
            />
          );
        if (!current && event.event_status !== 'published' && event.event_status !== 'cancelled')
          return (
            <article
              key={event.revision}
              className="fault-event-banner"
              aria-label={`待处理故障 ${faultBusinessLabel(event)}`}
            >
              <div className="fault-card-heading">
                <div className="fault-card-identity">
                  <h2>⚠️ 已登记设备故障：{event.machine_id} 停机</h2>
                  <p className="fault-analysis-window">
                    分析窗口：{stamp(event.started_at)} —{' '}
                    {event.recovered_at ? stamp(event.recovered_at) : '预计恢复时间未知'} ·{' '}
                    {faultBusinessLabel(event)}
                  </p>
                </div>
              </div>
              <p className="fault-impact-summary">
                当前状态：
                {event.event_status === 'pending_approval'
                  ? '待管理者审批'
                  : event.event_status === 'approved'
                    ? '已审批，待发布'
                    : '故障登记中'}
              </p>
            </article>
          );
        if (!current && trace)
          return (
            <PublishedFaultCard
              key={event.revision}
              failure={resolveFaultIdentity(trace.failure, state, event.revision)}

              version={trace.version}
              candidateLabel={trace.candidate_label}
              metrics={trace.metrics}
              label={`历史故障 ${faultBusinessLabel(event)}`}
              history
              onOpen={() => onHistory(event)}
            />
          );
        if (!current)
          return (
            <article
              key={event.revision}
              className="fault-history-item"
              aria-label={`历史故障 ${faultBusinessLabel(event)}`}
            >
              <h3>
                {event.machine_id} 停机 · {faultBusinessLabel(event)}
              </h3>
              <p>发生时间：{stamp(event.started_at)}</p>
              <p>
                分析窗口：{stamp(event.started_at)} —{' '}
                {event.recovered_at ? stamp(event.recovered_at) : '预计恢复时间未知'}
              </p>
              <AiAnalysisButton label="查看历史 AI 分析" onClick={() => onHistory(event)} />
            </article>
          );
        return (
          <div key={event.revision}>
            <section className="fault-event-banner" aria-label="已登记设备故障">
              <div className="fault-card-heading">
                <div className="fault-card-identity">
                  <h2>
                    <span aria-hidden="true">⚠️</span> 已登记设备故障：{event.machine_id} 停机
                  </h2>
                  <p className="fault-analysis-window">
                    分析窗口：{stamp(event.started_at)} —{' '}
                    {event.recovered_at ? stamp(event.recovered_at) : '预计恢复时间未知'}
                  </p>
                </div>
                <div className="fault-task-actions">
                  <AiAnalysisButton onClick={onAnalysis} />
                </div>
              </div>
              <div className="fault-process-row">
                <FaultProgress
                  scope="event"
                  state={state}
                  workflow={workflow}
                  simulation={simulation}
                />
                {state.fault_review && (
                  <button className="fault-review-link" onClick={onReview}>
                    审批详情
                  </button>
                )}
              </div>
              <p className="fault-impact-summary">
                <strong>
                  {reviewed
                    ? `预计结果：调整 ${reviewed.metrics.moved_operations} 道工序，${summary ? (summary.worsened.length ? `${summary.worsened.length} 个订单延期增加；` : '未新增延期；') : ''}预计 ${reviewed.metrics.late_orders} 个订单延期，共 ${reviewed.metrics.total_lateness_minutes} 分钟。`
                    : state.issues.length
                      ? state.issues.join('；')
                      : `当前计划有 ${state.affected.length} 道工序受故障影响。`}
                </strong>
              </p>
            </section>
          </div>
        );
      })}
      {!events.length && <p className="sales-muted">所选时间范围内暂无故障预警。</p>}
    </>
  );
}
