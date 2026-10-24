import type { Candidate, ContributionReport as Report, WorkflowResult } from '../api/contracts';
import { stamp } from '../lib/time';
import { planReport } from '../lib/planReport';
import { productionConditionLimitation } from '../lib/productionConditions';
import { TrustScore } from './TrustScore';

export function ContributionReport({
  report,
  candidate,
  result,
  published = false,
}: {
  report?: Report | null;
  candidate?: Candidate;
  result?: WorkflowResult | null;
  published?: boolean;
}) {
  if (!report && !candidate) return null;
  // The caller selects identity; never merge another candidate's report metrics.
  const impacts = candidate ? candidate.order_impacts : report?.order_impacts;
  const summary = planReport(impacts);
  const mostDelayed = summary?.late.reduce<NonNullable<typeof impacts>[number] | undefined>(
    (current, item) =>
      !current || item['新延期(分钟)'] > current['新延期(分钟)'] ? item : current,
    undefined,
  );
  const changes = candidate?.changes ?? [];
  const highlights = report?.model?.highlights ?? [];
  return (
    <section className="contribution-report" aria-label="系统模型与人工贡献报告">
      <h3>
        {report?.title ?? '方案评估报告'}
        {report?.revision ? ` · R${report.revision}` : ''}
      </h3>
      <p className="hint">
        {published ? '已发布方案的预计结果' : '预计结果'}，不代表实际生产完成情况。
      </p>
      {summary ? (
        <>
          <p className="plan-report-conclusion" aria-label="评估结果总结">
            <strong>方案结论：</strong>
            本方案共 <strong>{summary.late.length} 个订单延期</strong>，总延期{' '}
            <strong>{summary.total} 分钟</strong>； 相对执行计划基线的 {summary.baseline} 分钟，
            <strong>
              {summary.delta > 0
                ? `增加 ${summary.delta} 分钟`
                : summary.delta < 0
                  ? `减少 ${-summary.delta} 分钟`
                  : '保持不变'}
            </strong>
            。
            {mostDelayed && (
              <>
                延期最多的是订单 <strong>{mostDelayed.订单}</strong>，延期{' '}
                <strong>{mostDelayed['新延期(分钟)']} 分钟</strong>。
              </>
            )}
            <strong>
              {summary.delta > 0
                ? '按总延期指标，本方案未优于执行计划基线。'
                : summary.delta < 0
                  ? '按总延期指标，本方案优于执行计划基线。'
                  : '按总延期指标，本方案与执行计划基线持平。'}
            </strong>
          </p>
          <p>
            {summary.worsened.length ? (
              <>
                <strong>{summary.worsened.length} 个订单延期增加</strong>（
                {summary.worsened.map((item) => item.订单).join('、')}），需重点关注。
              </>
            ) : (
              <>
                <strong>未新增订单延期</strong>。
                {summary.late.length > 0 && '剩余延期均为调整前已有延期。'}
              </>
            )}
          </p>
        </>
      ) : (
        <p className="hint">订单交期差异记录不足，暂无法汇总相对执行计划的延期变化。</p>
      )}
      <TrustScore result={result ?? null} />
      <section className="plan-report-section" aria-label="延期结果">
        <h4>延期结果</h4>
        {summary && summary.late.length === 0 && <p>预计无订单延期。</p>}
        {!summary && <p className="hint">历史记录缺少完整订单交期数据，无法确认延期结果。</p>}
        {!!summary?.late.length && (
          <div className="table-scroll">
            <table aria-label="延期订单">
              <thead>
                <tr>
                  <th>订单</th>
                  <th>预计完工</th>
                  <th>延期</th>
                  <th>较调整前变化</th>
                </tr>
              </thead>
              <tbody>
                {summary.late.map((item) => {
                  const delta = item['新延期(分钟)'] - item['原延期(分钟)'];
                  return (
                    <tr key={item.订单}>
                      <td>
                        <strong>{item.订单}</strong>
                      </td>
                      <td>{stamp(item.新完工)}</td>
                      <td>
                        <strong>{item['新延期(分钟)']} 分钟</strong>
                      </td>
                      <td>
                        {delta === 0
                          ? '无变化'
                          : `${delta > 0 ? '增加' : '减少'} ${Math.abs(delta)} 分钟`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="plan-report-section" aria-label="关键调整">
        <h4>关键调整</h4>
        {changes.length > 0 ? (
          <>
            {changes.slice(0, 3).map((item) => (
              <p key={item.工序}>
                <strong>
                  {item.工序}：{item.原设备} → {item.新设备}
                </strong>
                ，
                {Date.parse(item.原开始) === Date.parse(item.新开始) &&
                Date.parse(item.原结束) === Date.parse(item.新结束)
                  ? '加工时段保持'
                  : '调整后加工时段'}{' '}
                {stamp(item.新开始)} — {stamp(item.新结束)}。
              </p>
            ))}
            {changes.length > 3 && (
              <p className="hint">另有 {changes.length - 3} 道工序调整，详见工序明细。</p>
            )}
          </>
        ) : (
          <p className="hint">未保存工序调整明细，请查看方案甘特图与工序对照。</p>
        )}
      </section>
      {!!report?.risks?.length && (
        <p className="hint">
          <strong>执行提醒：</strong>
          {report.risks.map(productionConditionLimitation).join('；')}
        </p>
      )}
      <details>
        <summary>查看评估依据与工序明细</summary>
        <p>
          <strong>规则系统：</strong>
          {report?.rules_work ?? '历史记录未保存规则工作明细。'}
        </p>
        <p>
          <strong>大模型：</strong>
          {report?.model_work ?? '历史记录未保存模型工作明细。'}
          {report?.model?.error_code && `（${report.model.error_code}）`}
        </p>
        {report?.comparison && <p className="hint">{report.comparison}</p>}
        {highlights.map((item, i) => (
          <p key={i}>{item.text}</p>
        ))}
        {changes.map((item) => (
          <p key={item.工序}>
            {item.工序}：{item.原设备} {stamp(item.原开始)} — {stamp(item.原结束)} → {item.新设备}{' '}
            {stamp(item.新开始)} — {stamp(item.新结束)}
          </p>
        ))}
        {!report?.risks && <p className="hint">历史记录未保存风险明细。</p>}
      </details>
      <details>
        <summary>查看调整与决策记录</summary>
        <p>
          <strong>人工调整：</strong>
          {report?.manual_summary ?? '未保存人工调整摘要。'}
        </p>
        {!!report?.edits?.length && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>工序 / 操作者</th>
                  <th>原安排</th>
                  <th>调整后</th>
                  <th>记录</th>
                </tr>
              </thead>
              <tbody>
                {report.edits.map((edit, i) => (
                  <tr key={i}>
                    <td>
                      {edit.operation_id}
                      <br />
                      {edit.operator}
                    </td>
                    <td>
                      {edit.before.machine_id}
                      <br />
                      {stamp(edit.before.start)} — {stamp(edit.before.end)}
                    </td>
                    <td>
                      {edit.after.machine_id}
                      <br />
                      {stamp(edit.after.start)} — {stamp(edit.after.end)}
                    </td>
                    <td>
                      {stamp(edit.at)}
                      <br />
                      {edit.reason || '未填写调整原因'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!report?.edits && <p className="hint">历史记录未保存人工修改明细。</p>}
        <p>
          <strong>报告生成时的决策状态：</strong>
          {report?.decision ?? '未保存决策状态。'}
        </p>
      </details>
    </section>
  );
}
