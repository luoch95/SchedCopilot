import { useEffect, useState } from 'react';

const pendingEntries = [
  ['fault-overview', '故障概览'],
  ['fault-baseline', '当前正式计划'],
  ['fault-generate', '生成候选方案'],
];
const candidateEntries = [
  ['fault-conclusion', '方案结论'],
  ['fault-compare-summary', '方案对比'],
  ['fault-candidate', '候选排产计划'],
  ['fault-evidence', '依据与风险'],
  ['fault-human-decision', '人工确认'],
];

export function FaultPlanOutline({ hasCandidates }: { hasCandidates: boolean }) {
  const entries = hasCandidates ? candidateEntries : pendingEntries;
  const [active, setActive] = useState(entries[0][0]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      let current = entries[0][0];
      for (const [id] of entries) {
        const target = document.getElementById(id);
        if (target && target.getBoundingClientRect().top <= window.innerHeight * 0.3) current = id;
      }
      setActive(current);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    setActive(entries[0][0]);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [entries]);
  return (
    <aside className="fault-stage-outline">
      <h2>本页提纲</h2>
      <nav aria-label="本页提纲">
        {entries.map(([id, label]) => (
          <a
            href={`#${id}`}
            key={id}
            aria-current={active === id ? 'location' : undefined}
            onClick={(event) => {
              event.preventDefault();
              const target = document.getElementById(id);
              if (!target) return;
              target.tabIndex = -1;
              target.scrollIntoView({
                behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
                  ? 'auto'
                  : 'smooth',
                block: 'start',
              });
              target.focus({ preventScroll: true });
              setActive(id);
            }}
          >
            {label}
          </a>
        ))}
      </nav>
    </aside>
  );
}
