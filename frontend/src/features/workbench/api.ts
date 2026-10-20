import { api, workflowStream } from '../../shared/api/http';
import type {
  InsertionAssessment,
  InsertionRequestCreate,
  InsertionRequestRecord,
  DecisionRequest,
  DecisionResult,
  SaveEventRequest,
  SnapshotVersion,
  Workbench,
  SalesOverview,
  ProcessingEstimate,
  WorkflowIntent,
  WorkflowProgressEvent,
  DemoFallbackStatus,
} from '../../shared/api/contracts';

/** The workbench's only transport adapter. Components never construct HTTP requests. */
export const workbenchApi = {
  assessRequest: (id: string) =>
    api<InsertionAssessment>(`/sales/requests/${encodeURIComponent(id)}/assessment`, {}),
  pendingRequests: (assignedPlanner?: string) =>
    api<InsertionRequestRecord[]>(
      `/sales/requests${assignedPlanner ? `?assigned_planner=${encodeURIComponent(assignedPlanner)}` : ''}`,
    ),
  requestDetail: (requestNo: string) =>
    api<InsertionRequestRecord>(`/sales/requests/${encodeURIComponent(requestNo)}`),
  actOnRequest: (
    id: string,
    action: 'approve' | 'reject' | 'publish',
    reason: string,
    assessment_id: string | undefined,
    operator_role: 'leader' | 'planner',
  ) =>
    api<InsertionRequestRecord>(`/sales/requests/${encodeURIComponent(id)}/actions`, {
      action,
      reason,
      assessment_id,
      operator_role,
    }),
  submitRequest: (request: InsertionRequestCreate) =>
    api<InsertionRequestRecord>('/sales/requests', request),
  salesOverview: () => api<SalesOverview>('/sales/overview'),
  processingEstimate: (product_id: string, quantity: number) =>
    api<ProcessingEstimate>('/sales/processing-estimate', { product_id, quantity }),
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
