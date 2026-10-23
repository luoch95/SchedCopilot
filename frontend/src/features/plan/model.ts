import type { Simulation, Workbench } from '../../shared/api/contracts';

export function timelineRange(
  state: Workbench,
  simulation: Simulation | null,
  zoom: number,
  pan: number,
): [number, number] {
  const operations = [
    ...state.baseline.operations,
    ...(simulation?.candidates.flatMap((item) => item.schedule.operations) || []),
  ];
  const start = Math.min(
    ...operations.map((op) => +new Date(op.start)),
    +new Date(state.event.started_at),
  );
  const end = Math.max(
    ...operations.map((op) => +new Date(op.end)),
    state.event.recovered_at
      ? +new Date(state.event.recovered_at)
      : +new Date(state.event.started_at) + 4 * 3600_000,
  );
  const total = Math.max(3600_000, end - start),
    visible = total / zoom;
  const from = start + (total - visible) * pan;
  return [from, from + visible];
}

/** Published chart bounds must not move when an unapproved fault is recorded. */
export function publishedPlanRange(state: Workbench, zoom: number, pan: number): [number, number] {
  const traces =
    state.plan_publication?.version === state.baseline.version
      ? (state.plan_publication.fault_traces ?? [])
      : [];
  const times = [
    ...state.baseline.operations.flatMap((op) => [Date.parse(op.start), Date.parse(op.end)]),
    ...traces.flatMap(({ failure }) => [
      Date.parse(failure.started_at),
      Date.parse(failure.recovered_at ?? failure.started_at),
    ]),
  ].filter(Number.isFinite);
  const start = times.length ? Math.min(...times) : 0;
  const end = times.length ? Math.max(...times) : start;
  const total = Math.max(3600_000, end - start);
  const visible = total / zoom;
  const from = start + (total - visible) * pan;
  return [from, from + visible];
}
