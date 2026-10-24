import type { Workbench } from '../api/contracts';
import { inDateRange, newestFirst, type DateRange } from './dateRange';

/** Current faults and published history share one filter across role dashboards. */
export function visibleFaultEvents(state: Workbench, range: DateRange) {
  // A saved revision is not a separate outage. Keep current and published records,
  // rather than showing superseded siblings with empty reports and delete actions.
  const sameOutage = (left: Workbench['event'], right: Workbench['event']) =>
    left.machine_id === right.machine_id &&
    new Date(left.started_at).getTime() === new Date(right.started_at).getTime();
  const publishedTraces = state.plan_publication?.fault_traces ?? [];
  return [
    ...(state.event_history ?? []).filter(
      (event) =>
        event.revision !== state.event_revision &&
        !event.cancelled &&
        (publishedTraces.some((trace) => trace.event_revision === event.revision) ||
          ((!sameOutage(event, state.event) || state.event_cancelled) &&
            !publishedTraces.some((trace) => sameOutage(event, trace.failure)))),
    ),
    ...(state.event_cancelled
      ? []
      : [
          {
            ...state.event,
            revision: state.event_revision,
            created_at:
              state.event_history?.find((event) => event.revision === state.event_revision)
                ?.created_at ?? state.event.received_at,
          },
        ]),
  ]
    .filter((event) => inDateRange(event.started_at, range))
    .sort(
      (a, b) =>
        newestFirst(a.created_at || a.started_at, b.created_at || b.started_at) ||
        b.revision - a.revision,
    );
}
