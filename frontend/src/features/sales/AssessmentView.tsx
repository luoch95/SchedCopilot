import { TraceTree, TraceBadge } from '../../shared/ui/TraceTree';
import { useEffect, useRef } from 'react';
import { StatusTag } from '../../shared/ui/StatusTag';
import { KnowledgePanel } from '../../shared/ui/KnowledgePanel';
import { useGanttSelection } from '../../shared/ui/GanttSelection';
import type { InsertionAssessment } from '../../shared/api/contracts';
import { operationLabels } from './presentation';
import { localInput, stamp } from '../../shared/lib/time';
import { BusinessLabelProvider, useBusinessText } from '../../shared/lib/BusinessLabelProvider';

interface AssessmentProps {
  result: InsertionAssessment;
  requestNo?: string;
  planner?: boolean;
  stale?: boolean;
  published?: boolean;
}

export function AssessmentView(props: AssessmentProps) {
  const operations = props.result.details.operations.map((op) => ({
    ...op,
    id: op.operation_id,
    ...operationLabels(props.result, op, props.requestNo),
  }));
  return (
    <BusinessLabelProvider operations={operations}>
      <AssessmentContent {...props} />
    </BusinessLabelProvider>
  );
}

function AssessmentContent({
  result,
  requestNo,
  planner = false,
  stale = false,
  published = false,
}: AssessmentProps) {
  const format = useBusinessText();
  const summary = result.summary;
  const selection = useGanttSelection();
  const operationsDetails = useRef<HTMLDetailsElement>(null);
  const selectedOperationId = selection?.operationId;
  useEffect(() => {
    if (
      planner &&
      selectedOperationId &&
      result.details.operations.some((op) => op.operation_id === selectedOperationId) &&
      operationsDetails.current
    ) {
      operationsDetails.current.open = true;
    }
  }, [planner, selectedOperationId, result]);
  return (
    <section className="insertion-assessment" aria-label="已保存的试排结果">
      {stale && <p role="alert">执行计划、事件或生产资源已变化，此试排结果已过期，请重新试排。</p>}
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
        受影响订单个数统计原订单最终完成时间变化；延期加重订单数统计交期延误增加，不包含插单自身。下表仅对新增交期延误大于
        0 的订单标黄并标记“受影响”，仅完工时间推迟但未新增交期延误的订单不标记。
      </p>
      <details>
        <summary>订单延期变化明细</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>订单</th>
                <th>原完成时间</th>
                <th>试排预计完工</th>
                <th>
                  交期延误(分钟){' '}
                  <button
                    type="button"
                    className="lateness-help"
                    aria-label="交期延误计算说明"
                    title="此处计算的是超出客户要求交期的时长，而非单纯的完工时间变化。"
                  >
                    ?
                  </button>
                  <small>原 / 试排后</small>
                </th>
                <th>新增交期延误</th>
              </tr>
            </thead>
            <tbody>
              {summary.order_impacts.map((row) => (
                <tr
                  key={row.order_id}
                  className={row.delay_delta_minutes > 0 ? 'order-impact-changed' : undefined}
                >
                  <td>
                    {result.details.operations.find((op) => op.order_id === row.order_id)
                      ?.order_display_name ?? row.order_id}{' '}
                    · {row.order_name}
                    {row.delay_delta_minutes > 0 && (
                      <span className="order-impact-label">受影响</span>
                    )}
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
      {planner && result.workflow?.trace_id && (
        <details>
          <summary>
            执行详情 <TraceBadge traceId={result.workflow.trace_id} />
          </summary>
          <TraceTree
            traceId={result.workflow.trace_id}
            steps={result.workflow.trace.map((step) => ({
              ...step,
              knowledge:
                step.agent === 'explanation' ? result.workflow?.explanation.knowledge : undefined,
              label:
                (
                  {
                    validation: '影响范围校验',
                    scheduling: '产能交期试算',
                    evaluation: '风险代价评估',
                    explanation: '决策依据生成',
                  } as Record<string, string>
                )[step.agent] ?? '分析环节',
            }))}
          />
        </details>
      )}
      {result.workflow && (
        <details>
          <summary>试排影响明细</summary>
          <section aria-label="试排影响明细">
            <p className="sales-muted">
              {result.workflow.mode === 'live'
                ? '大模型辅助分析 · 排产与交期指标由规则工具计算并校验'
                : result.workflow.mode === 'fallback'
                  ? '大模型辅助暂不可用，已保留规则试排结果，可继续审批与复核。'
                  : '规则试排分析'}
            </p>
            <div className="insertion-agent-strip">
              {result.workflow.trace.map((step) => (
                <div key={step.agent}>
                  <strong>
                    {(
                      {
                        validation: '影响范围校验',
                        scheduling: '产能交期试算',
                        evaluation: '风险代价评估',
                        explanation: '决策依据生成',
                      } as Record<string, string>
                    )[step.agent] ?? '试排处理'}
                  </strong>
                  <span className={step.status === 'success' ? 'trial-step-success' : undefined}>
                    {step.status === 'success' ? (
                      <>
                        <span aria-hidden="true">✅</span> 已完成
                      </>
                    ) : (
                      ((
                        {
                          warning: '需关注',
                          failed: '处理失败',
                          blocked: '暂不可继续',
                          running: '处理中',
                          pending: '待处理',
                        } as Record<string, string>
                      )[step.status] ?? '状态待确认')
                    )}
                  </span>
                  {step.execution && (
                    <>
                      <small className="sales-muted">
                        {step.mode === 'live' ? '大模型辅助完成' : '已回退规则分析'}
                      </small>
                      {step.execution.highlights.length > 0 && (
                        <ul className="trial-impact-points">
                          {step.execution.highlights.map((item) => (
                            <li key={item.text}>{format(item.text)}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
            <ul className="trial-impact-points">
              <li>预计完工：{localInput(summary.estimated_completion_at).replace('T', ' ')}</li>
              <li>
                影响范围：涉及 {summary.affected_order_count} 个原订单，其中{' '}
                {summary.newly_delayed_order_count} 个交期延误加重。
              </li>
              <li>
                决策提醒：
                {stale && !published
                  ? '试排结果已过期，需重新试排并重新审批。'
                  : !summary.meets_due
                    ? '插单预计无法满足要求交期，需确认交期及取舍。'
                    : summary.newly_delayed_order_count > 0
                      ? '原订单交期延误加重，需管理者确认取舍。'
                      : '原订单未新增交期延误，仍需按流程审批与复核。'}
              </li>
              <li>
                流程声明：
                {published
                  ? '该结果已由计划员复核发布，此处保留发布前的试排快照。'
                  : '当前为试排结果，审批通过后由计划员复核发布，不直接修改执行计划。'}
              </li>
            </ul>
            <KnowledgePanel report={result.workflow.explanation.knowledge} />
          </section>
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
          <p key={text}>{format(text)}</p>
        ))}
      </details>
      {planner && (
        <details ref={operationsDetails}>
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
                  <th className="status-column">状态</th>
                </tr>
              </thead>
              <tbody>
                {result.details.operations.map((op) => (
                  <tr
                    key={op.operation_id}
                    data-operation-id={op.operation_id}
                    aria-selected={selectedOperationId === op.operation_id}
                    className={
                      selectedOperationId === op.operation_id ? 'operation-row-selected' : undefined
                    }
                  >
                    <td>
                      {operationLabels(result, op, requestNo).display_name} · 第{op.sequence}道
                    </td>
                    <td>
                      {op.machine_id} / {op.mold_id}
                    </td>
                    <td>
                      {stamp(op.setup_start)} / {op.setup_minutes}
                    </td>
                    <td>{stamp(op.start)}</td>
                    <td>{stamp(op.end)}</td>
                    <td className="status-column">
                      <StatusTag status={op.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.baseline_resource_issues.map((issue) => (
            <p key={issue} className="conflict-notice">
              <span className="conflict-notice-icon" role="img" aria-label="冲突警告">
                ⚠️
              </span>
              <span>{format(issue)}</span>
            </p>
          ))}
        </details>
      )}
      <p className="sales-muted">试排摘要仅供参考，具体设备与工序安排将由排产计划员复核发布</p>
    </section>
  );
}
