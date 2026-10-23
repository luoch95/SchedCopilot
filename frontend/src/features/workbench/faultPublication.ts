import type { Workbench } from '../../shared/api/contracts';

/** Published evidence is historical; it must never become publishable candidates. */
export function publishedFault(state: Workbench | null) {
  const publication = state?.plan_publication;
  const analysis = publication?.fault_analysis;
  return state &&
    publication?.version === state.baseline.version &&
    analysis?.event_revision === state.event_revision
    ? analysis
    : null;
}
