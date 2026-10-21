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
  mode = 'full',
}: {
  state: Workbench;
  simulation: Simulation;
  range: [number, number];
  workflow: WorkflowResult | null;
  mode?: 'full' | 'plans' | 'details';
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
      <section
        id={mode === 'details' ? 'fault-comparison-details' : 'fault-comparison'}
        tabIndex={-1}
        className="section"
        aria-label={mode === 'details' ? '方案计算明细' : '候选方案比较'}
      >
        {' '}
        {mode === 'full' && (
          <div className="section-heading">
            <div>
              <p className="eyebrow">SCENARIO COMPARISON</p>
              <h2 id="section-comparison">方案比较</h2>
            </div>
            <span className="tag">{candidates.length} 套候选 · 尚未发布</span>
          </div>
        )}
        {mode === 'full' && <MetricsTable candidates={candidates} />}
        {mode === 'full' && workflow && (
          <EvaluationSummary result={workflow} simulation={simulation} />
        )}
        {mode === 'full' && (
          <p className="hint">
            原计划对照保留原设备及加工顺序，按故障、换型和班次约束顺延。允许转移方案优先选择最早开工的合格设备，也可能主动调整未在故障设备上的工序；具体原因见下方工序说明。
          </p>
        )}
        {mode !== 'details' && (
          <div id="fault-gantts" tabIndex={-1}>
            {mode === 'full' && (
              <h3 id="section-gantts" className="block-title">
                双甘特图对比
              </h3>
            )}
            <div className="candidate-grid">
              {candidates.map((item) => (
                <article
                  className={`candidate-card ${isWaiting(item) ? 'candidate-waiting' : 'candidate-optimized'}`}
                  key={item.id}
                  aria-label={isWaiting(item) ? '原计划对照排产图' : `${item.label}排产图`}
                >
                  <header>
                    <h3>{isWaiting(item) ? '原计划对照' : item.label}</h3>
                    <span>{item.metrics.moved_operations} 道工序调整</span>
                  </header>
                  <p className="candidate-delay">
                    总延期 {item.metrics.total_lateness_minutes} 分钟
                  </p>
                  {isWaiting(item) && <p className="hint">原设备等待恢复后的排产候选 · 尚未发布</p>}
                  <Gantt
                    tone={isWaiting(item) ? 'red' : 'green'}
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
              <span>各图共用时间范围；红色为原计划对照，绿色为优化方案，色阶区分订单</span>
            </p>
          </div>
        )}
        {mode !== 'plans' && (
          <>
            <OperationComparison state={state} candidates={candidates} />
            <OrderComparison state={state} candidates={candidates} />
            <ImpactChains candidates={candidates} />
            <EvidenceComparison candidates={candidates} workflow={workflow} />
          </>
        )}
      </section>
    </GanttSelectionProvider>
  );
}
