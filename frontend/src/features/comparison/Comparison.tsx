import Gantt from '../../shared/ui/Gantt';
import type { Simulation, Workbench } from '../../shared/api/contracts';
import { MetricsTable } from './MetricsTable';
import { OperationComparison } from './OperationComparison';
import { OrderComparison } from './OrderComparison';
import { ImpactChains } from './ImpactChains';
import { EvidenceComparison } from './EvidenceComparison';
export function Comparison({
  state,
  simulation,
  range,
}: {
  state: Workbench;
  simulation: Simulation;
  range: [number, number];
}) {
  const candidates = simulation.candidates;
  return (
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
      <div className="candidate-grid">
        {candidates.map((item) => (
          <article className="candidate-card" key={item.id}>
            <header>
              <h3>{item.label}</h3>
              <span>{item.metrics.moved_operations} 道工序调整</span>
            </header>
            <Gantt
              schedule={item.schedule}
              baseline={state.baseline}
              failure={state.event}
              machines={state.machines}
              range={range}
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
        <span>两图共用时间范围与订单颜色</span>
      </p>
      <OperationComparison state={state} candidates={candidates} />
      <OrderComparison state={state} candidates={candidates} />
      <ImpactChains candidates={candidates} />
      <EvidenceComparison candidates={candidates} />
    </section>
  );
}
