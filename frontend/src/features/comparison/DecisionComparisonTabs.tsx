import { useRef } from 'react';
import type { Simulation, Workbench, WorkflowResult } from '../../shared/api/contracts';
import { OperationComparison } from './OperationComparison';
import { OrderComparison } from './OrderComparison';
import { ImpactChains } from './ImpactChains';
import { EvidenceComparison } from './EvidenceComparison';

export const comparisonTabs = [
  ['section-operations', '4.4 工序调整对照'],
  ['section-orders', '4.5 订单交付对照'],
  ['section-impact', '4.6 工序变化与影响链'],
  ['section-evidence', '4.7 方案计算依据'],
] as const;

export function DecisionComparisonTabs({
  state,
  simulation,
  workflow,
  active,
  onActive,
  referenceWorkflow,
}: {
  state: Workbench;
  simulation?: Simulation | null;
  workflow: WorkflowResult | null;
  active: string;
  onActive: (id: string) => void;
  referenceWorkflow?: WorkflowResult | null;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const candidates = simulation?.candidates ?? [];
  return (
    <div className="decision-comparison-tabs">
      <div role="tablist" aria-label="详细排程对比" className="decision-tablist">
        {comparisonTabs.map(([id, title], index) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`${id}-tab`}
            aria-controls={`${id}-panel`}
            aria-selected={active === id}
            tabIndex={active === id ? 0 : -1}
            ref={(element) => {
              refs.current[index] = element;
            }}
            onClick={() => onActive(id)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === 'ArrowRight') next = (index + 1) % comparisonTabs.length;
              else if (event.key === 'ArrowLeft')
                next = (index + comparisonTabs.length - 1) % comparisonTabs.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = comparisonTabs.length - 1;
              else return;
              event.preventDefault();
              onActive(comparisonTabs[next][0]);
              refs.current[next]?.focus();
            }}
          >
            {title}
          </button>
        ))}
      </div>
      {comparisonTabs.map(([id, title], index) => (
        <section
          role="tabpanel"
          id={`${id}-panel`}
          key={id}
          aria-labelledby={`${id}-tab`}
          hidden={active !== id}
          tabIndex={0}
        >
          <h3 id={id}>{title}</h3>
          {!candidates.length ? (
            <p className="empty-state">尚无候选方案，暂无可用对比。</p>
          ) : (
            <>
              {index === 0 && (
                <OperationComparison state={state} candidates={candidates} showHeading={false} />
              )}
              {index === 1 && (
                <OrderComparison state={state} candidates={candidates} showHeading={false} />
              )}
              {index === 2 && <ImpactChains candidates={candidates} showHeading={false} />}
              {index === 3 && (
                <EvidenceComparison
                  candidates={candidates}
                  workflow={workflow}
                  referenceWorkflow={referenceWorkflow}
                  flat
                />
              )}
            </>
          )}
        </section>
      ))}
    </div>
  );
}
