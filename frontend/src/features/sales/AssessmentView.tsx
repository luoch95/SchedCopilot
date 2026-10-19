import type { InsertionAssessment } from '../../shared/api/contracts';
import { stamp } from '../../shared/lib/time';

export function AssessmentView({
  result,
  planner = false,
  stale = false,
  published = false,
}: {
  result: InsertionAssessment;
  planner?: boolean;
  stale?: boolean;
  published?: boolean;
}) {
  const summary = result.summary;
  return (
    <section className="insertion-assessment" aria-label="已保存的试排结果">
      {stale && <p role="alert">正式计划、事件或生产资源已变化，此试排结果已过期，请重新试排。</p>}
      <p>
        试排基线 V{result.baseline_version} · {stamp(result.created_at)} ·{' '}
        {published ? '该试排已发布，保留发布前评估快照' : stale ? '已过期' : '已保存，未发布'}
      </p>
      <dl className="sales-empty-metrics">
        <div>
          <dt>预计完成时间</dt>
          <dd>{stamp(summary.estimated_completion_at)}</dd>
        </div>
        <div>
          <dt>是否满足交期</dt>
          <dd>{summary.meets_due ? '满足' : '不满足'}</dd>
        </div>
        <div>
          <dt>受影响订单个数</dt>
          <dd>{summary.affected_order_count}</dd>
        </div>
        <div>
          <dt>延期加重订单数</dt>
          <dd>{summary.newly_delayed_order_count}</dd>
        </div>
      </dl>
      <p className="sales-muted">
        受影响订单指原订单最终完成时间变化；延期加重指延期分钟数增加，不包含插单自身。工序调整但订单完成时间未变的不计入受影响订单。
      </p>
      <details>
        <summary>订单延期变化明细</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>订单</th>
                <th>原完成时间</th>
                <th>试排完成时间</th>
                <th>原延期 / 新延期（分钟）</th>
                <th>延期变化（分钟）</th>
              </tr>
            </thead>
            <tbody>
              {summary.order_impacts.map((row) => (
                <tr key={row.order_id}>
                  <td>
                    {row.order_id} · {row.order_name}
                  </td>
                  <td>{stamp(row.original_completion_at)}</td>
                  <td>{stamp(row.projected_completion_at)}</td>
                  <td>
                    {row.original_lateness_minutes} / {row.projected_lateness_minutes}
                  </td>
                  <td>
                    {row.delay_delta_minutes > 0 ? '+' : ''}
                    {row.delay_delta_minutes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {result.workflow && (
        <details>
          <summary>四 Agent 分析记录（规则模式）</summary>
          {result.workflow.trace.map((step) => (
            <p key={step.agent}>
              {step.agent} · {step.status} · {step.mode}
            </p>
          ))}
          {[
            ...result.workflow.explanation.facts,
            ...result.workflow.explanation.risks,
            ...result.workflow.explanation.next_steps,
          ].map((text) => (
            <p key={text}>{text}</p>
          ))}
        </details>
      )}
      {result.baseline_resource_issues.length > 0 && (
        <p className="sales-muted">
          原计划存在资源约束缺口，本次完成时间变化同时包含换型或停机约束修正，不能全部归因于插单。
        </p>
      )}
      <details>
        <summary>试排口径与限制</summary>
        {result.assumptions.map((text) => (
          <p key={text}>{text}</p>
        ))}
      </details>
      {planner && (
        <details>
          <summary>设备与工序排布明细</summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>工序</th>
                  <th>设备 / 模具</th>
                  <th>换型开始 / 分钟</th>
                  <th>加工开始</th>
                  <th>加工结束</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {result.details.operations.map((op) => (
                  <tr key={op.operation_id}>
                    <td>
                      {op.operation_id} · 第{op.sequence}道
                    </td>
                    <td>
                      {op.machine_id} / {op.mold_id}
                    </td>
                    <td>
                      {stamp(op.setup_start)} / {op.setup_minutes}
                    </td>
                    <td>{stamp(op.start)}</td>
                    <td>{stamp(op.end)}</td>
                    <td>{op.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.baseline_resource_issues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
        </details>
      )}
      <p className="sales-muted">试排摘要仅供参考，具体设备与工序安排将由排产计划员复核发布</p>
    </section>
  );
}
