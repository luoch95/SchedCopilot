import type { FaultAnalysis, Workbench } from '../../shared/api/contracts';

/** Published evidence is historical; it must never become publishable candidates. */
export function publishedFault(state: Workbench | null) {
  const publication = state?.plan_publication;
  const current = publication?.current_fault_analysis;
  if (
    state &&
    current?.event_revision === state.event_revision &&
    current.published_version &&
    current.published_version <= state.baseline.version &&
    publication?.version === state.baseline.version
  )
    return current;
  const analysis = publication?.fault_analysis;
  if (
    state &&
    publication?.version === state.baseline.version &&
    analysis?.event_revision === state.event_revision
  )
    return analysis;
  return null;
}

export function publishedFaultSummary(state: Workbench | null): Partial<FaultAnalysis> | null {
  const full = publishedFault(state);
  if (full) return full;
  const publication = state?.plan_publication;
  // Overview responses retain publication traces but omit full analysis bodies.
  const trace =
    state && publication?.version === state.baseline.version
      ? publication.fault_traces?.find(
          (item) =>
            item.event_revision === state.event_revision &&
            item.version <= state.baseline.version &&
            (state.event.fault_event_id
              ? item.failure.fault_event_id === state.event.fault_event_id
              : item.failure.machine_id === state.event.machine_id &&
                Date.parse(item.failure.started_at) === Date.parse(state.event.started_at)),
        )
      : undefined;
  return trace
    ? ({
        event_revision: trace.event_revision,
        published_version: trace.version,
        workflow: null,
      } satisfies Partial<FaultAnalysis>)
    : null;
}
