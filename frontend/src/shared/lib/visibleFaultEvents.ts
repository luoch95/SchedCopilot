import type { Failure, Workbench } from '../api/contracts';
import { inDateRange, newestFirst, type DateRange } from './dateRange';

export function faultBusinessLabel(event: {
  machine_id: string;
  fault_business_code?: string | null;
  fault_process_stage?: string;
  revision?: number;
}) {
  if (event.fault_business_code) {
    return `${event.fault_business_code}-${event.fault_process_stage ?? '001'}`;
  }
  return `${event.machine_id} · 编号缺失`;
}

/** Recover archived identity without borrowing another outage's business number. */
export function resolveFaultIdentity(
  failure: Failure,
  state: Workbench,
  revision: number,
): Failure {
  const events = [
    { ...state.event, revision: state.event_revision },
    ...(state.event_history ?? []),
  ];
  const matching = events.filter((event) =>
    failure.fault_event_id
      ? event.fault_event_id === failure.fault_event_id && event.machine_id === failure.machine_id
      : event.revision === revision &&
        event.machine_id === failure.machine_id &&
        Date.parse(event.started_at) === Date.parse(failure.started_at),
  );
  const identity = matching.find((event) => event.fault_business_code);
  return {
    ...failure,
    fault_event_id: failure.fault_event_id ?? identity?.fault_event_id,
    fault_business_code: failure.fault_business_code ?? identity?.fault_business_code,
    fault_process_stage: identity?.fault_process_stage ?? failure.fault_process_stage,
  };
}

/** Current faults and published history share one filter across role dashboards. */
export function visibleFaultEvents(state: Workbench, range: DateRange) {
  const saved = state.event_history ?? [];
  const sameOutage = (left: Workbench['event'], right: Workbench['event']) =>
    left.machine_id === right.machine_id &&
    new Date(left.started_at).getTime() === new Date(right.started_at).getTime();
  const publishedTraces = state.plan_publication?.fault_traces ?? [];
  const events = [
    ...saved.filter(
      (event) =>
        event.revision !== state.event_revision &&
        !event.cancelled &&
        event.event_status !== 'cancelled' &&
        (publishedTraces.some((trace) => trace.event_revision === event.revision) ||
          ((!sameOutage(event, state.event) || state.event_cancelled) &&
            !publishedTraces.some((trace) => sameOutage(event, trace.failure)))),
    ),
    ...(state.event_cancelled
      ? []
      : [
          saved.find((event) => event.revision === state.event_revision) ?? {
            ...state.event,
            revision: state.event_revision,
            fault_business_code: state.event.fault_business_code,
            fault_process_stage: state.event.fault_process_stage ?? '001',
            created_at: state.event.received_at,
            event_status: 'registered' as const,
          },
        ]),
  ];
  return events
    .filter((event) => !event.cancelled && event.event_status !== 'cancelled')
    .filter((event) => inDateRange(event.started_at, range))
    .sort(
      (a, b) =>
        newestFirst(a.created_at || a.started_at, b.created_at || b.started_at) ||
        b.revision - a.revision,
    );
}
