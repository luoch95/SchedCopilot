import type { Candidate } from '../../shared/api/contracts';
import { DecisionText } from '../../shared/ui/DecisionText';
import { businessText } from '../../shared/lib/businessLabels';

const IMPACT_TYPES = ['直接影响', '连锁影响', '策略调整'];

export function ImpactChains({ candidates }: { candidates: Candidate[] }) {
  return (
    <>
      {' '}
      <h3 className="block-title">工序变化与影响链</h3>
      <div className="impact-type-legend" aria-label="影响类型图例">
        {IMPACT_TYPES.map((type) => (
          <span className="impact-type" key={type}>
            <i />
            {type}
          </span>
        ))}
      </div>
      <div className="candidate-grid">
        {candidates.map((item) => (
          <article className="chain-card" key={item.id}>
            <h4>{item.label}</h4>
            {item.changes.map((change) => (
              <div className="chain-item" key={change.工序}>
                <strong>{businessText(change.工序, item.schedule.operations)}</strong>
                <div
                  className="impact-type-options"
                  aria-label={`影响类型：${businessText(change.工序, item.schedule.operations)}`}
                >
                  {IMPACT_TYPES.map((type) => (
                    <span
                      className={`impact-type-badge ${type === change.类型 ? 'active' : 'dim'}`}
                      aria-current={type === change.类型 ? 'true' : undefined}
                      key={type}
                    >
                      {type}
                    </span>
                  ))}
                </div>
                <p>{businessText(change.影响链, item.schedule.operations)}</p>
                <small>
                  依据：
                  <DecisionText text={businessText(change.依据, item.schedule.operations)} />
                </small>
              </div>
            ))}
            {!item.changes.length && <p className="hint">该方案没有改变任何工序。</p>}
          </article>
        ))}
      </div>
    </>
  );
}
