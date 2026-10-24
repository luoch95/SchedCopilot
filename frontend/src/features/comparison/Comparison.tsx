import { WriteButton } from '../../shared/ui/WriteButton';
import Gantt from '../../shared/ui/Gantt';
import { GanttSelectionProvider } from '../../shared/ui/GanttSelection';
import type { Simulation, Workbench, WorkflowResult } from '../../shared/api/contracts';
import { EvaluationSummary } from './EvaluationSummary';
import { MetricsTable } from './MetricsTable';
import { OperationComparison } from './OperationComparison';
import { OrderComparison } from './OrderComparison';
import { ImpactChains } from './ImpactChains';
import { EvidenceComparison } from './EvidenceComparison';
import { Accordion } from '../../shared/ui/Accordion';
import { candidateKind, candidateTitle } from '../../shared/lib/candidatePresentation';
export function Comparison({
  state,
  simulation,
  range,
  workflow,
  mode = 'full',
  archived = false,
  adoption,
  referenceWorkflow,
}: {
  state: Workbench;
  simulation: Simulation;
  range: [number, number];
  workflow: WorkflowResult | null;
  mode?: 'full' | 'plans' | 'details';
  archived?: boolean;
  referenceWorkflow?: WorkflowResult | null;
  adoption?: {
    selected: string;
    disabled: boolean;
    onAdopt: (candidateId: string) => void;
  };
}) {
  const candidates = simulation.candidates;
  const isWaiting = (item: (typeof candidates)[number]) =>
    candidateKind(item, workflow, referenceWorkflow) === 'waiting';
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
            <span className="tag">
              {candidates.length} 套候选 · {archived ? '原始分析存档' : '尚未发布'}
            </span>
          </div>
        )}
        {mode === 'full' && <MetricsTable candidates={candidates} />}
        {mode === 'full' && workflow && (
          <EvaluationSummary result={workflow} simulation={simulation} />
        )}
        {mode === 'full' && (
          <p className="hint">
            原计划对照保留原设备及加工顺序顺延；班次容纳不下时，生成原线排尾草案并提示超班风险。允许转移方案优先选择最早开工的合格设备；具体原因见下方工序说明。
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
              {candidates.length === 1 && (
                <article
                  className="candidate-card candidate-waiting"
                  aria-label="当前执行计划排产图"
                >
                  <header>
                    <h3>当前执行计划 V{state.baseline.version}</h3>
                    <span>调整前基线</span>
                  </header>
                  <div className="candidate-caption">
                    <p className="hint">已发布计划；本次候选尚未发布。</p>
                  </div>
                  <Gantt
                    tone="red"
                    affectedOperationIds={state.affected}
                    schedule={state.baseline}
                    failure={state.event}
                    faults={(state.plan_publication?.version === state.baseline.version
                      ? (state.plan_publication.fault_traces ?? [])
                      : []
                    ).map((trace) => ({
                      failure: trace.failure,
                      faultTrace: {
                        version: trace.version,
                        affectedOperations: trace.affected_operations,
                      },
                    }))}
                    machines={state.machines}
                    range={range}
                  />
                </article>
              )}
              {candidates.map((item) => (
                <article
                  className={`candidate-card ${isWaiting(item) ? 'candidate-waiting' : 'candidate-optimized'}${adoption?.selected === item.id ? ' is-selected' : ''}`}
                  data-selected={adoption?.selected === item.id || undefined}
                  key={item.id}
                  aria-label={`${candidateTitle(item, workflow, referenceWorkflow)}排产图`}
                >
                  <header>
                    <h3>{candidateTitle(item, workflow, referenceWorkflow)}</h3>
                    <div className="candidate-header-meta">
                      {adoption &&
                        !archived &&
                        candidateKind(item, workflow, referenceWorkflow) === 'transfer' && (
                          <span className="candidate-recommendation">AI 允许转移</span>
                        )}
                      <span>{item.metrics.moved_operations} 道工序调整</span>
                    </div>
                  </header>
                  <div className="candidate-caption">
                    <p className="candidate-delay">
                      总延期 {item.metrics.total_lateness_minutes} 分钟
                    </p>
                    {isWaiting(item) && (
                      <p className="hint">
                        原设备等待恢复后的排产候选 · {archived ? '原始分析存档' : '尚未发布'}
                      </p>
                    )}
                  </div>
                  <Gantt
                    tone={isWaiting(item) ? 'red' : archived ? 'published' : 'green'}
                    affectedOperationIds={
                      isWaiting(item)
                        ? [
                            ...state.affected,
                            ...item.changes.map((change) => change.工序),
                            ...item.schedule.operations
                              .filter(
                                (op) =>
                                  op.status === 'planned' &&
                                  item.order_impacts.some(
                                    (impact) =>
                                      impact.订单 === op.order_id && impact['新增延期(分钟)'] > 0,
                                  ),
                              )
                              .map((op) => op.id),
                          ]
                        : []
                    }
                    schedule={item.schedule}
                    baseline={state.baseline}
                    failure={state.event}
                    machines={state.machines}
                    range={range}
                    changes={item.changes}
                  />
                  {adoption && !archived && (
                    <footer className="candidate-actions">
                      <WriteButton
                        className={adoption.selected === item.id ? 'primary' : undefined}
                        disabled={adoption.disabled}
                        aria-pressed={adoption.selected === item.id}
                        onClick={() => adoption.onAdopt(item.id)}
                      >
                        {candidateKind(item, workflow, referenceWorkflow) === 'manual'
                          ? '采纳人工方案'
                          : isWaiting(item)
                            ? '采纳 AI 等待方案'
                            : candidateKind(item, workflow, referenceWorkflow) === 'transfer'
                              ? '采纳 AI 转移方案'
                              : '采纳此方案'}
                      </WriteButton>
                    </footer>
                  )}
                </article>
              ))}
            </div>
            <p className="outline-legend" aria-label="甘特图图例">
              <span>
                <i className="baseline-completed-fill" />
                原计划 · 已完工
              </span>
              <span>
                <i className="baseline-fill" />
                原计划 · 未完工
              </span>
              <span>
                <i className="conflict-outline" />
                受影响订单 · 未完工
              </span>
              <span>
                <i className="optimized-completed-fill" />
                优化方案 · 已完工
              </span>
              <span>
                <i className="generated-fill" />
                生成方案 · 未完工
              </span>
              <span>
                <i className="published-fill" />
                已发布方案 · 未完工
              </span>
              <span>
                <i className="fault-pattern-fill" />
                停机留痕
              </span>
            </p>
          </div>
        )}
        {mode !== 'plans' && (
          <>
            <OperationComparison state={state} candidates={candidates} />
            <OrderComparison state={state} candidates={candidates} />
            <Accordion title="工序变化与影响链">
              <ImpactChains candidates={candidates} showHeading={false} />
            </Accordion>
            <EvidenceComparison candidates={candidates} workflow={workflow} />
          </>
        )}
      </section>
    </GanttSelectionProvider>
  );
}
