import { api } from '../../shared/api/http';
import type {
  AnalysisResult,
  DecisionRequest,
  DecisionResult,
  SaveEventRequest,
  Simulation,
  SnapshotVersion,
  Workbench,
} from '../../shared/api/contracts';

/** The workbench's only transport adapter. Components never construct HTTP requests. */
export const workbenchApi = {
  load: () => api<Workbench>('/workbench'),
  saveEvent: (request: SaveEventRequest) => api<Workbench>('/event', request, 'PUT'),
  recoverEvent: (version: SnapshotVersion) => api<Workbench>('/event/recover', version),
  simulate: (version: SnapshotVersion) => api<Simulation>('/simulations', version),
  analyze: (request: SnapshotVersion & { live: boolean; question: string }) =>
    api<AnalysisResult>('/analysis', request),
  decide: (request: DecisionRequest) => api<DecisionResult>('/decisions', request),
};
