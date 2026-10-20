import { useEffect, useId, useRef, useState } from 'react';
import type { PlanPublication } from '../../shared/api/contracts';
import { localInput } from '../../shared/lib/time';

export function PlanVersionTag({
  version,
  publication,
}: {
  version: number;
  publication?: PlanPublication;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();
  const info = publication?.version === version ? publication : undefined;
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return (
    <span
      className="plan-version"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="plan-version-tag"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`查看执行计划 V${version} 发布信息`}
        onClick={() => setOpen(!open)}
      >
        V{version}
      </button>
      {open && (
        <span id={id} className="plan-version-card" role="region" aria-label="计划版本发布信息">
          <strong>执行计划版本 V{version}</strong>
          <span>
            发布时间：
            {info?.published_at ? localInput(info.published_at).replace('T', ' ') : '未记录'}
          </span>
          <span>发布人：{info?.published_by ?? '未记录'}</span>
          <span>
            变更摘要：
            {info?.version_summary ?? (version === 1 ? '初始演示计划' : '历史版本，未记录发布信息')}
          </span>
        </span>
      )}
    </span>
  );
}
