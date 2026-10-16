import type { Candidate } from '../../shared/api/contracts';
export function ImpactChains({ candidates }: { candidates: Candidate[] }) {
  return (
    <>
      {' '}
      <h3 className="block-title">工序变化与影响链</h3>
      <div className="candidate-grid">
        {candidates.map((item) => (
          <article className="chain-card" key={item.id}>
            <h4>{item.label}</h4>
            {item.changes.map((change) => (
              <div className="chain-item" key={change.工序}>
                <strong>
                  {change.工序}
                  <span className="tag">{change.类型}</span>
                </strong>
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
