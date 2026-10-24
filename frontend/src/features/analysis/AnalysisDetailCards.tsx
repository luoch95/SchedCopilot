import { useState } from 'react';
import type { Simulation, WorkflowResult } from '../../shared/api/contracts';
import { DecisionText, EvidenceText } from '../../shared/ui/DecisionText';
import { stamp } from '../../shared/lib/time';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
// Recognize only redundant presentation templates, never infer business values from prose.
const snapshotFact = (text: string) =>
  /^(策略 .+ 的候选包含 \d+ 项工序变更。|订单 .+ 工序 .+：设备 |候选 .+ 已有指标与差异评价。|候选总延期 |候选换型 |设备 .+ 班次利用率 |订单 .+：交期 .+；预计完工 )/.test(
    text,
  );

export function AnalysisDetailCards({
  result,
  simulation,
}: {
  result: WorkflowResult;
  simulation?: Simulation | null;
}) {
  const [candidateId, setCandidateId] = useState('');
  const candidates = simulation?.candidates ?? [];
  const candidate = candidates.find((item) => item.id === candidateId) ?? candidates[0];
  const data = result.results.explanation?.data;
  const evaluation = result.results.evaluation?.data?.evaluations?.find(
    (item) => item.candidate_id === candidate?.id,
  );
  const metrics = record(evaluation && result.evidence_catalog[evaluation.metrics_ref]?.content);
  const loads = Array.isArray(metrics.machine_loads) ? metrics.machine_loads.map(record) : [];
  // Replace only facts backed by the structured sections below. Preserve other evidence.
  const represented = new Set(
    candidate
      ? Object.entries(result.evidence_catalog)
          .filter(
            ([, evidence]) =>
              evidence.kind === 'candidate_changes' &&
              candidates.some((item) => item.id === record(evidence.content).candidate_id),
          )
          .map(([ref]) => ref)
      : [],
  );
  if (candidate) {
    for (const item of result.results.evaluation?.data?.evaluations ?? []) {
      if (!candidates.some((entry) => entry.id === item.candidate_id)) continue;
      represented.add(item.metrics_ref);
      if (item.differences_ref) represented.add(item.differences_ref);
    }
  }
  const notes = [
    {
      title: '补充事实',
      texts: data?.facts
        ?.slice(1)
        .filter(
          (item) =>
            !(snapshotFact(item.text) && item.evidence_refs.some((ref) => represented.has(ref))),
        )
        .map((item) => item.text),
    },
    { title: '假设', texts: data?.assumptions?.slice(1).map((item) => item.text) },
    { title: '风险', texts: data?.risks?.slice(1).map((item) => item.text) },
    { title: '取舍', texts: data?.tradeoffs?.slice(1).map((item) => item.text) },
    { title: '限制', texts: data?.limitations },
  ].filter((group) => group.texts?.length);
  return (
    <div className="analysis-detail-content">
      {candidate ? (
        <>
          <label className="analysis-candidate-picker">
            查看方案
            <select value={candidate.id} onChange={(event) => setCandidateId(event.target.value)}>
              {candidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="analysis-detail-grid">
            <section
              className="analysis-data-card analysis-operation-card"
              aria-label="工序变动快照"
            >
              <h4>工序变动快照</h4>
              {candidate.changes.length ? (
                candidate.changes.map((change) => (
                  <article className="analysis-operation-row" key={change.工序}>
                    <strong title={change.工序}>
                      <EvidenceText text={change.工序} />
                    </strong>
                    <div className="analysis-before-after">
                      <span>
                        <small>原安排</small>
                        <b>{change.原设备}</b>
                        <span>
                          {stamp(change.原开始)} — {stamp(change.原结束)}
                        </span>
                      </span>
                      <span className="analysis-change-arrow" aria-label="调整为">
                        →
                      </span>
                      <span>
                        <small>新安排</small>
                        <b>{change.新设备}</b>
                        <span>
                          {stamp(change.新开始)} — {stamp(change.新结束)}
                        </span>
                      </span>
                    </div>
                    <p className="hint">
                      <DecisionText text={change.依据} />
                    </p>
                  </article>
                ))
              ) : (
                <p className="hint">该方案未调整工序。</p>
              )}
            </section>
            <section className="analysis-data-card" aria-label="指标核算">
              <h4>指标核算</h4>
              <dl className="analysis-metric-grid">
                <div>
                  <dt>总延期</dt>
                  <dd>
                    {candidate.metrics.total_lateness_minutes}
                    <small>分钟</small>
                  </dd>
                </div>
                <div>
                  <dt>延期订单</dt>
                  <dd>
                    {candidate.metrics.late_orders}
                    <small>个</small>
                  </dd>
                </div>
                <div>
                  <dt>换型次数</dt>
                  <dd>
                    {number(metrics.changeovers) ?? '—'}
                    <small>{number(metrics.changeovers) === null ? '未计算' : '次'}</small>
                  </dd>
                </div>
                <div>
                  <dt>调整工序</dt>
                  <dd>
                    {candidate.metrics.moved_operations}
                    <small>道</small>
                  </dd>
                </div>
                {loads.map((load, index) => (
                  <div key={index}>
                    <dt>{String(load.machine_id ?? '设备')} 班次利用率</dt>
                    <dd>
                      {number(load.utilization) === null
                        ? '—'
                        : `${(Number(load.utilization) * 100).toFixed(1)}%`}
                    </dd>
                  </div>
                ))}
              </dl>
              {!loads.length && <p className="hint">班次利用率：未计算。</p>}
              <p className="hint">利用率按加工与换型时间占扣除故障后的可用班次计算。</p>
            </section>
            <section className="analysis-data-card analysis-orders-card" aria-label="受影响订单">
              <h4>受影响订单</h4>
              {candidate.order_impacts.length ? (
                <div className="table-wrap">
                  <table aria-label="订单完工与延期快照">
                    <thead>
                      <tr>
                        <th scope="col">订单</th>
                        <th scope="col">原定完工</th>
                        <th scope="col">预计完工</th>
                        <th scope="col">延期（分钟）</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidate.order_impacts.map((impact) => (
                        <tr key={impact.订单}>
                          <th scope="row" title={impact.订单}>
                            <EvidenceText text={impact.订单} />
                          </th>
                          <td>{stamp(impact.原完工)}</td>
                          <td>{stamp(impact.新完工)}</td>
                          <td className={impact['新延期(分钟)'] > 0 ? 'late-text' : undefined}>
                            {impact['原延期(分钟)']} → <strong>{impact['新延期(分钟)']}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="hint">暂无订单交付明细。</p>
              )}
            </section>
          </div>
        </>
      ) : (
        <p className="hint">当前无候选快照，保留下方分析依据。</p>
      )}
      {notes.length > 0 && (
        <div className="analysis-notes-grid">
          {notes.map((group) => (
            <section className="analysis-note-card" key={group.title}>
              <h4>{group.title}</h4>
              {[...new Set(group.texts)].map((text, index) => (
                <p key={index}>
                  <DecisionText text={text!} />
                </p>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
