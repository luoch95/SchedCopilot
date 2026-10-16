import type { Candidate } from '../../shared/api/contracts';

const IMPACT_TYPES = ['直接影响', '连锁影响', '策略调整'];

export function ImpactChains({ candidates }: { candidates: Candidate[] }) {
  return (
    <>
      {' '}
      <h3 className="block-title">工序变化与影响链</h3>
      <div className="impact-type-legend" aria-label="影响类型图例">
        {IMPACT_TYPES.map((type) => {
          const active = candidates.some((candidate) =>
            candidate.changes.some((change) => change.类型 === type),
          );
          return (
            <span className={active ? 'impact-type active' : 'impact-type dim'} key={type}>
              <i />
              {type}
            </span>
          );
        })}
      </div>
      <div className="candidate-grid">
        {candidates.map((item) => (
          <article className="chain-card" key={item.id}>
            <h4>{item.label}</h4>
            {item.changes.map((change) => (
              <div className="chain-item" key={change.工序}>
                <strong>{change.工序}</strong>
                <div className="impact-type-options" aria-label={`影响类型：${change.工序}`}>
                  {IMPACT_TYPES.map((type) => (
                    <span
                      className={`impact-type-badge ${type === change.类型 ? 'active' : 'dim'}`}
                      key={type}
                    >
                      {type}
                    </span>
                  ))}
                </div>
                <p>{change.影响链}</p>
                <small>依据：{change.依据}</small>
              </div>
            ))}
            {!item.changes.length && <p className="hint">该方案没有改变任何工序。</p>}
          </article>
        ))}
      </div>
    </>
  );
}
