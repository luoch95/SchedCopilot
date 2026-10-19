import type { Candidate, WorkflowResult } from '../../shared/api/contracts';
import { WorkflowDebugDetails } from '../../shared/ui/WorkflowEvidence';
import { DecisionText } from '../../shared/ui/DecisionText';

export function EvidenceComparison({
  candidates,
  workflow,
}: {
  candidates: Candidate[];
  workflow: WorkflowResult | null;
}) {
  return (
    <>
      <h3 className="block-title">方案计算依据</h3>
      <div className="candidate-grid">
        {candidates.map((item) => {
          const catalog = workflow?.evidence_catalog ?? {};
          const evaluation = workflow?.results.evaluation?.data?.evaluations?.find(
            (row) => row.candidate_id === item.id,
          );
          const refs = new Set(item.evidence.filter((ref) => ref in catalog));
          for (const [ref, evidence] of Object.entries(catalog)) {
            const content = evidence.content;
            if (
              content &&
              typeof content === 'object' &&
              'candidate_id' in content &&
              content.candidate_id === item.id
            )
              refs.add(ref);
          }
          if (evaluation) {
            refs.add(evaluation.metrics_ref);
            if (evaluation.differences_ref) refs.add(evaluation.differences_ref);
          }
          const rawMetrics = evaluation && catalog[evaluation.metrics_ref]?.content;
          const hasProductionMetrics =
            rawMetrics &&
            typeof rawMetrics === 'object' &&
            'changeover_minutes' in rawMetrics &&
            typeof rawMetrics.changeover_minutes === 'number';
          return (
            <article className="evidence-cell" key={item.id}>
              <h4>{item.label}</h4>
              <details className="workflow-evidence" aria-label={`${item.label}计算依据`}>
                <summary>查看计算依据</summary>
                <h5>计算口径</h5>
                <ul>
                  <li>
                    订单延期：按每个订单最后一道工序的完工时间与交期计算，累计超期分钟；未排入计划的订单不视为准时。
                  </li>
                  <li>工序调整：对照当前正式计划，统计开工时间或设备发生变化的工序。</li>
                  {hasProductionMetrics ? (
                    <li>
                      换型按实体模具切换规则计算；班次利用率＝（加工分钟＋换型分钟）÷扣除故障的班次可用分钟。
                    </li>
                  ) : (
                    <li>换型及班次利用率以评估结果为准；缺少数据时保留缺项，不按零计算。</li>
                  )}
                </ul>
                <h5>输入与假设</h5>
                <ul>
                  {item.assumptions.map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ul>
                {!item.assumptions.length && <p>当前候选未提供假设说明。</p>}
                <h5>调整依据</h5>
                <ul>
                  {item.changes.map((change) => (
                    <li key={change.工序}>
                      <strong>{change.工序}</strong>：<DecisionText text={change.依据} />
                    </li>
                  ))}
                </ul>
                {!item.changes.length && <p>该候选未调整任何工序。</p>}
                <WorkflowDebugDetails
                  data={{
                    candidate: item,
                    evaluation,
                    evidence_catalog: Object.fromEntries(
                      [...refs].map((ref) => [ref, catalog[ref] ?? { error: '证据不可用' }]),
                    ),
                  }}
                />
              </details>
            </article>
          );
        })}
      </div>
    </>
  );
}
