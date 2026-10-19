import { api, workflowStream } from '../../shared/api/http';
import type {
  DecisionRequest,
  DecisionResult,
  SaveEventRequest,
  SnapshotVersion,
  Workbench,
  WorkflowIntent,
  WorkflowProgressEvent,
} from '../../shared/api/contracts';

/** The workbench's only transport adapter. Components never construct HTTP requests. */
export const workbenchApi = {
  load: () => api<Workbench>('/workbench'),
  saveEvent: (request: SaveEventRequest) => api<Workbench>('/event', request, 'PUT'),
  recoverEvent: (version: SnapshotVersion) => api<Workbench>('/event/recover', version),
  workflow: (
    request: SnapshotVersion & { intent: WorkflowIntent; question: string; workflow_id?: string },
    onProgress: (event: WorkflowProgressEvent) => void,
  ) => workflowStream(request, onProgress),
  decide: (request: DecisionRequest) => api<DecisionResult>('/decisions', request),
};
