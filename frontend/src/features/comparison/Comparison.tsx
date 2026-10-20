import Gantt from '../../shared/ui/Gantt';
import { GanttSelectionProvider } from '../../shared/ui/GanttSelection';
import type { Simulation, Workbench, WorkflowResult } from '../../shared/api/contracts';
import { EvaluationSummary } from './EvaluationSummary';
import { MetricsTable } from './MetricsTable';
import { OperationComparison } from './OperationComparison';
import { OrderComparison } from './OrderComparison';
import { ImpactChains } from './ImpactChains';
import { EvidenceComparison } from './EvidenceComparison';
export function Comparison({
  state,
  simulation,
  range,
  workflow,
}: {
  state: Workbench;
  simulation: Simulation;
  range: [number, number];
  workflow: WorkflowResult | null;
}) {
  const candidates = simulation.candidates;
  const waitingIds = new Set(
    workflow?.results.scheduling?.data?.candidates
      ?.filter((candidate) => candidate.strategy_id === 'wait-recovery')
      .map((candidate) => candidate.candidate_id),
  );
  const isWaiting = (item: (typeof candidates)[number]) =>
    waitingIds.has(item.id) ||
    item.id === 'wait-recovery' ||
    item.label === '原设备等待恢复' ||
    item.label === '原计划对照';
  return (
    <GanttSelectionProvider>
      <section className="section" aria-labelledby="comparison-title">
        {' '}
        <div className="section-heading">
          <div>
            <p className="eyebrow">SCENARIO COMPARISON</p>
            <h2 id="comparison-title">方案比较</h2>
          </div>
          <span className="tag">{candidates.length} 套候选 · 尚未发布</span>
        </div>
        <MetricsTable candidates={candidates} />{' '}
        {workflow && <EvaluationSummary result={workflow} simulation={simulation} />}
        <p className="hint">
          原计划对照保留原设备及加工顺序，按故障、换型和班次约束顺延。允许转移方案优先选择最早开工的合格设备，也可能主动调整未在故障设备上的工序；具体原因见下方工序说明。
        </p>
        <div className="candidate-grid">
          {candidates.map((item) => (
            <article
              className="candidate-card"
              key={item.id}
              aria-label={isWaiting(item) ? '原计划对照排产图' : `${item.label}排产图`}
            >
              <header>
                <h3>{isWaiting(item) ? '原计划对照' : item.label}</h3>
                <span>{item.metrics.moved_operations} 道工序调整</span>
              </header>
              {isWaiting(item) && <p className="hint">原设备等待恢复后的排产候选 · 尚未发布</p>}
              <Gantt
                schedule={item.schedule}
                baseline={state.baseline}
                failure={state.event}
                machines={state.machines}
                range={range}
                changes={item.changes}
              />
            </article>
          ))}
        </div>
        <p className="outline-legend">
          <span>
            <i className="purple-outline" />
            设备转移
          </span>
          <span>
            <i className="amber-outline" />
            仅调整时间
          </span>
          <span>各图共用时间范围与订单颜色</span>
        </p>
        <OperationComparison state={state} candidates={candidates} />
        <OrderComparison state={state} candidates={candidates} />
        <ImpactChains candidates={candidates} />
        <EvidenceComparison candidates={candidates} workflow={workflow} />
      </section>
    </GanttSelectionProvider>
  );
}
