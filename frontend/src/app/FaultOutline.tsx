import { useEffect, useRef, useState } from 'react';

const entries = [
  { id: 'section-plan', label: '执行计划概览', parent: null },
  { id: 'section-current-plan', label: '当前执行计划', parent: 'section-plan' },
  { id: 'section-impact', label: '直接影响范围', parent: 'section-plan' },
  { id: 'section-generation', label: '智能分析链路', parent: null },
  { id: 'section-workflow', label: '本次智能分析链路', parent: 'section-generation' },
  { id: 'section-execution', label: '执行详情', parent: 'section-generation' },
  { id: 'section-comparison', label: '方案比较', parent: null },
  { id: 'section-gantts', label: '双甘特图对比', parent: 'section-comparison' },
  { id: 'section-analysis', label: '辅助分析', parent: null },
  { id: 'section-facts', label: '事实、假设与风险', parent: 'section-analysis' },
  { id: 'section-advice', label: '取舍与建议', parent: 'section-analysis' },
  { id: 'section-confirm', label: '人工确认', parent: null },
  { id: 'section-input', label: '决策输入', parent: 'section-confirm' },
  { id: 'section-history', label: '历史记录', parent: 'section-confirm' },
];

/** Fixed business anchors; page text and table content never define the outline. */
export function FaultOutline() {
  const [availableIds, setAvailableIds] = useState<string[]>([]);
  const [active, setActive] = useState('');
  const revealTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(revealTimer.current), []);
  useEffect(() => {
    const workspace = document.querySelector('.fault-decision-layout .workspace');
    if (!workspace) return;
    let headings: HTMLElement[] = [];
    let frame = 0;
    const visible = (heading: HTMLElement) => {
      let parent = heading.parentElement;
      while (parent && parent !== workspace) {
        if (
          parent instanceof HTMLDetailsElement &&
          !parent.open &&
          !parent.querySelector(':scope > summary')?.contains(heading)
        )
          return false;
        parent = parent.parentElement;
      }
      return true;
    };
    const update = () => {
      const available = headings.filter(visible);
      let current = available[0];
      for (const heading of available) {
        if (heading.getBoundingClientRect().top <= window.innerHeight * 0.3) current = heading;
      }
      const last = available.at(-1);
      const height = document.documentElement.scrollHeight;
      if (
        last &&
        height > window.innerHeight &&
        window.scrollY + window.innerHeight >= height - 4 &&
        last.getBoundingClientRect().top < window.innerHeight
      )
        current = last;
      setActive(current?.id ?? '');
    };
    const collect = () => {
      headings = entries
        .map((entry) => document.getElementById(entry.id))
        .filter((node): node is HTMLElement => !!node && workspace.contains(node));
      headings.forEach((heading) => {
        heading.tabIndex = -1;
      });
      const ids = headings.map((heading) => heading.id);
      setAvailableIds((previous) => (previous.join() === ids.join() ? previous : ids));
      update();
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    collect();
    const mutations = new MutationObserver(collect);
    mutations.observe(workspace, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['id'],
    });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resize?.observe(workspace);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    workspace.addEventListener('toggle', schedule, true);
    return () => {
      mutations.disconnect();
      resize?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      workspace.removeEventListener('toggle', schedule, true);
    };
  }, []);
  const ancestors = new Set<string>();
  let current = entries.find((entry) => entry.id === active);
  while (current) {
    ancestors.add(current.id);
    current = entries.find((entry) => entry.id === current!.parent);
  }
  const renderBranch = (parent: string | null) => (
    <ul>
      {entries
        .filter((entry) => entry.parent === parent)
        .map((entry) => (
          <li key={entry.id}>
            {availableIds.includes(entry.id) ? (
              <a
                href={`#${entry.id}`}
                data-active={ancestors.has(entry.id) || undefined}
                aria-current={active === entry.id ? 'location' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  const target = document.getElementById(entry.id);
                  if (!target) return;
                  let ancestor = target.parentElement;
                  while (ancestor) {
                    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
                    ancestor = ancestor.parentElement;
                  }
                  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
                  // Allow disclosure layout transitions to finish before measuring the scroll target.
                  const reveal = () => {
                    target.scrollIntoView({
                      behavior: reduced ? 'auto' : 'smooth',
                      block: 'start',
                    });
                    target.focus({ preventScroll: true });
                    setActive(entry.id);
                  };
                  clearTimeout(revealTimer.current);
                  if (target.closest('details'))
                    revealTimer.current = setTimeout(reveal, reduced ? 0 : 260);
                  else reveal();
                }}
              >
                {entry.label}
              </a>
            ) : (
              <span aria-disabled="true">{entry.label}</span>
            )}
            {entries.some((child) => child.parent === entry.id) && renderBranch(entry.id)}
          </li>
        ))}
    </ul>
  );
  return (
    <aside className="fault-outline">
      <nav aria-label="故障决策大纲">
        <p className="fault-outline-title">本页大纲</p>
        <div className="fault-outline-scroll">{renderBranch(null)}</div>
      </nav>
    </aside>
  );
}
