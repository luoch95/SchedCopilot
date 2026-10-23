import { useEffect, useState } from 'react';
import type { Workbench } from '../../shared/api/contracts';
import { workbenchApi } from '../workbench';
import { CurrentPlan } from './CurrentPlan';
import { timelineRange } from './model';

/** Read the same published snapshot as the planner; no simulation or editing actions. */
export function LeaderFormalPlan() {
  const [state, setState] = useState<Workbench | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    workbenchApi
      .load()
      .then((value) => {
        if (active) setState(value);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  const refresh = (
    <button disabled={loading} onClick={() => setRevision((value) => value + 1)}>
      同步最新计划
    </button>
  );
  if (error)
    return (
      <section className="section">
        <h2>当前执行计划</h2>
        <p role="alert">执行计划读取失败，请重试。</p>
        {refresh}
      </section>
    );
  if (!state)
    return (
      <section className="section">
        <h2>当前执行计划</h2>
        <p role="status">正在读取执行计划…</p>
      </section>
    );
  return (
    <section aria-label="生产计划甘特图" aria-busy={loading}>
      <CurrentPlan
        compact
        state={state}
        range={timelineRange(state, null, zoom, pan)}
        zoom={zoom}
        pan={pan}
        onZoom={setZoom}
        onPan={setPan}
        actions={refresh}
      />
    </section>
  );
}
