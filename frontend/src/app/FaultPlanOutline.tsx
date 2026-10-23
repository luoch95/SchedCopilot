import { useEffect, useRef, useState } from 'react';
import { evidenceEntries } from './FaultDecisionEvidence';

const chapters = [
  ['fault-conclusion', '1 方案结论'],
  ['fault-compare-summary', '2 方案对比'],
  ['fault-candidate', '3 候选排产计划'],
  ['fault-evidence', '4 依据与风险'],
  ['fault-human-decision', '5 人工确认'],
  ['fault-history', '6 历史记录'],
] as const;
const entries = [...chapters.slice(0, 4), ...evidenceEntries, ...chapters.slice(4)];

export function FaultPlanOutline({ onSelectTab }: { onSelectTab: (id: string) => void }) {
  const [active, setActive] = useState<string>(chapters[0][0]);
  const navigationFrame = useRef(0);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      let current: string = chapters[0][0];
      for (const [id] of entries) {
        const target = document.getElementById(id);
        if (!target || target.closest('[hidden]')) continue;
        const disclosure = target.closest('details');
        if (disclosure && !disclosure.open && !target.closest('summary')) continue;
        if (target.getBoundingClientRect().top <= Math.min(180, window.innerHeight * 0.3))
          current = id;
      }
      setActive(current);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('toggle', schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(navigationFrame.current);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('toggle', schedule, true);
    };
  }, []);
  return (
    <aside className="fault-stage-outline">
      <p className="fault-outline-title">本页大纲</p>
      <nav aria-label="本页大纲">
        {entries.map(([id, label]) => (
          <a
            href={`#${id}`}
            key={id}
            className={id.startsWith('section-') ? 'fault-outline-child' : undefined}
            aria-current={active === id ? 'location' : undefined}
            onClick={(event) => {
              event.preventDefault();
              if (
                [
                  'section-operations',
                  'section-orders',
                  'section-impact',
                  'section-evidence',
                ].includes(id)
              )
                onSelectTab(id);
              const target = document.getElementById(id);
              if (!target) return;
              const disclosure = target.closest('details');
              if (disclosure) disclosure.open = true;
              cancelAnimationFrame(navigationFrame.current);
              navigationFrame.current = requestAnimationFrame(() => {
                target.tabIndex = -1;
                target.scrollIntoView?.({
                  behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
                    ? 'auto'
                    : 'smooth',
                  block: 'start',
                });
                target.focus({ preventScroll: true });
                setActive(id);
              });
            }}
          >
            {label}
          </a>
        ))}
      </nav>
    </aside>
  );
}
