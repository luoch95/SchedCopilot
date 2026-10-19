import { api, workflowStream } from '../../shared/api/http';
import type {
  DecisionRequest,
  DecisionResult,
  SaveEventRequest,
  SnapshotVersion,
  Workbench,
  WorkflowIntent,
  WorkflowProgressEvent,
  DemoFallbackStatus,
} from '../../shared/api/contracts';

/** The workbench's only transport adapter. Components never construct HTTP requests. */
export const workbenchApi = {
  demoStatus: () => api<DemoFallbackStatus>('/workflow/demo'),
  load: () => api<Workbench>('/workbench'),
  saveEvent: (request: SaveEventRequest) => api<Workbench>('/event', request, 'PUT'),
  recoverEvent: (version: SnapshotVersion) => api<Workbench>('/event/recover', version),
  workflow: (
    request: SnapshotVersion & {
      intent: WorkflowIntent;
      question: string;
      workflow_id?: string;
      demo_fallback?: boolean;
    },
    onProgress: (event: WorkflowProgressEvent) => void,
    signal?: AbortSignal,
  ) => workflowStream(request, onProgress, signal),
  decide: (request: DecisionRequest) => api<DecisionResult>('/decisions', request),
};
