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
