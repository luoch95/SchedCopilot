import { api, workflowStream } from '../../shared/api/http';
import type { Metrics } from '../../shared/api/metrics';
import { orderLabel } from '../../shared/lib/orderLabels';
import type {
  CopilotAnswer,
  ManualFaultDraft,
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
  WorkflowResponse,
  WorkflowProgressEvent,
  DemoFallbackStatus,
} from '../../shared/api/contracts';

/** The workbench's only transport adapter. Components never construct HTTP requests. */
export const workbenchApi = {
  ask: (request: SnapshotVersion & { workflow_id: string; question: string }) =>
    api<CopilotAnswer>('/copilot/ask', request),
  cancelEvent: (version: SnapshotVersion, revision?: number) =>
    api<Workbench>(
      revision === undefined ? '/event/cancel' : `/events/${revision}/cancel`,
      version,
    ),
  manualDraft: () => api<ManualFaultDraft | null>('/fault-drafts/latest'),
  createManualDraft: (workflow_id: string, simulation_id?: string, candidate_id?: string) =>
    api<ManualFaultDraft>('/fault-drafts', {
      workflow_id,
      simulation_id,
      candidate_id,
      operator_role: 'planner',
    }),
  saveManualDraft: (
    id: string,
    revision: number,
    moves: { operation_id: string; machine_id: string; start: string }[],
    reason: string,
  ) =>
    api<ManualFaultDraft>(
      `/fault-drafts/${encodeURIComponent(id)}`,
      { revision, moves, reason, operator_role: 'planner' },
      'PUT',
    ),
  confirmManualDraft: (id: string, revision: number) =>
    api<ManualFaultDraft>(`/fault-drafts/${encodeURIComponent(id)}/confirm`, {
      revision,
      operator_role: 'planner',
    }),
  recordVisit: () => api<void>('/visits'),
  adminSession: () => api<{ admin: boolean }>('/demo/session'),
  adminLogin: (password: string) => api<{ admin: boolean }>('/demo/login', { password }),
  adminLogout: () => api('/demo/logout', {}),
  adminMetrics: () => api<Metrics>('/admin/metrics'),
  weeklyMetrics: () => api<Metrics>('/reports/weekly'),
  submitFaultReview: (
    simulation_id: string,
    candidate_id: string,
    reason: string,
    request_id: string,
  ) =>
    api<Workbench>('/fault-reviews', {
      simulation_id,
      candidate_id,
      reason,
      request_id,
      operator_role: 'planner',
    }),
  reviewFault: (id: string, action: 'approve' | 'reject', reason: string) =>
    api<Workbench>(`/fault-reviews/${encodeURIComponent(id)}/actions`, {
      action,
      reason,
      operator_role: 'leader',
    }),
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
  salesOverview: async () => {
    const overview = await api<SalesOverview>('/sales/overview');
    const needsNumbers = overview.orders.some(
      (order) =>
        orderLabel(order.display_name ?? order.id) !== (order.display_name ?? order.id) ||
        orderLabel(order.name) !== order.name,
    );
    // Older running backends omit display_name. Resolve from persisted request_no as well.
    const requests = needsNumbers
      ? await api<InsertionRequestRecord[]>('/sales/requests').catch(() => [])
      : [];
    return {
      ...overview,
      orders: overview.orders.map((order) => ({
        ...order,
        display_name: orderLabel(order.display_name ?? order.id, requests),
        name: orderLabel(order.name, requests),
      })),
    };
  },
  processingEstimate: (product_id: string, quantity: number) =>
    api<ProcessingEstimate>('/sales/processing-estimate', { product_id, quantity }),
  demoStatus: () => api<DemoFallbackStatus>('/workflow/demo'),
  load: () => api<Workbench>('/workbench'),
  latestWorkflow: () => api<WorkflowResponse | null>('/workflow/latest'),
  submitAssessmentReview: (id: string, reason: string, request_id: string) =>
    api<Workbench>(`/workflow/${encodeURIComponent(id)}/review`, {
      reason,
      request_id,
      operator_role: 'planner',
    }),
  faultAnalysis: (revision: number) =>
    api<NonNullable<NonNullable<Workbench['plan_publication']>['fault_analysis']> | null>(
      `/events/${revision}/analysis`,
    ),
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
