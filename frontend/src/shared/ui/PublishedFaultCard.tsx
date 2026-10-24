import type { Candidate, Failure } from '../api/contracts';
import { planReport } from '../lib/planReport';
import { stamp } from '../lib/time';
import { AiAnalysisButton } from './AiAnalysisButton';

/** Only render for faults backed by an actual publication archive or trace. */
export function PublishedFaultCard({
  failure,
  revision,
  version,
  candidateLabel,
  metrics,
  orderImpacts,
  label,
  history = false,
  onOpen,
  onReview,
}: {
  failure: Failure;
  revision: number;
  version?: number;
  candidateLabel?: string;
  metrics?: Candidate['metrics'];
  orderImpacts?: Candidate['order_impacts'];
  label: string;
  history?: boolean;
  onOpen: () => void;
  onReview?: () => void;
}) {
  const publishedLabel = version === undefined ? '已发布 · 版本记录缺失' : `已发布 V${version}`;
  const summary = planReport(orderImpacts);
  const steps = [
    ['故障登记', '已保存'],
    ['AI 分析方案', '已完成'],
    ['管理者审批', '已批准'],
    ['计划发布', publishedLabel],
  ];
  return (
    <article className="fault-event-banner is-published" aria-label={label}>
      <div className="fault-card-heading">
        <div className="fault-card-identity">
          <h2>
            <span aria-hidden="true">✓</span> {failure.machine_id} 停机 · R{revision} ·{' '}
            {publishedLabel}
          </h2>
          <p className="fault-analysis-window">
            分析窗口：{stamp(failure.started_at)} —{' '}
            {failure.recovered_at ? stamp(failure.recovered_at) : '恢复时间未知'}
          </p>
        </div>
        <div className="fault-task-actions">
          <AiAnalysisButton
            label={history ? '查看历史 AI 分析' : '查看 AI 分析详情'}
            onClick={onOpen}
          />
        </div>
      </div>
      <div className="fault-process-row">
        <ol className="fault-progress" aria-label="故障处理流程">
          {steps.map(([title, detail]) => (
            <li key={title} className="is-complete" aria-label={`${title}：${detail}`}>
              <span className="fault-progress-node" aria-hidden="true">
                ✓
              </span>
              <span className="fault-progress-copy">
                <strong>{title}</strong>
                <small>{detail}</small>
              </span>
            </li>
          ))}
        </ol>
        {onReview && (
          <button className="fault-review-link" onClick={onReview}>
            审批详情
          </button>
        )}
      </div>
      <p className="fault-impact-summary">
        <strong>已发布方案的预计结果：</strong>
        {metrics ? (
          <strong>
            {candidateLabel ? `已发布${candidateLabel}` : '方案已发布'}；调整{' '}
            {metrics.moved_operations} 道工序，
            {summary
              ? summary.worsened.length
                ? `${summary.worsened.length} 个订单延期增加；`
                : '未新增延期；'
              : ''}
            预计 {metrics.late_orders} 个订单延期，共 {metrics.total_lateness_minutes} 分钟。
          </strong>
        ) : (
          <span>方案已发布，历史指标记录缺失，详细结论请查看分析存档。</span>
        )}
      </p>
    </article>
  );
}
