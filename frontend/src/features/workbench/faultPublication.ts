import type { Workbench } from '../../shared/api/contracts';

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
  return state &&
    publication?.version === state.baseline.version &&
    analysis?.event_revision === state.event_revision
    ? analysis
    : null;
}
