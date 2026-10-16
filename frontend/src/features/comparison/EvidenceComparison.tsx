import type { Candidate } from '../../shared/api/contracts';
export function EvidenceComparison({ candidates }: { candidates: Candidate[] }) {
  return (
    <>
      {' '}
      <h3 className="block-title">证据与假设</h3>
      <div className="evidence-grid">
        {candidates.map((item) => (
          <h4 key={item.id}>{item.label}</h4>
        ))}
        {(['evidence', 'assumptions'] as const).map((field) => (
          <EvidenceRows key={field} candidates={candidates} field={field} />
        ))}
      </div>
    </>
  );
}
function EvidenceRows({
  candidates,
  field,
}: {
  candidates: Candidate[];
  field: 'evidence' | 'assumptions';
}) {
  return (
    <>
      <div className="evidence-label">{field === 'evidence' ? '决策证据' : '适用假设'}</div>
      {Array.from(
        { length: Math.max(...candidates.map((item) => item[field].length)) },
        (_, index) =>
          candidates.map((item) => (
            <div className="evidence-cell" key={`${item.id}-${index}`}>
              {item[field][index] || '—'}
            </div>
          )),
      )}
    </>
  );
}
