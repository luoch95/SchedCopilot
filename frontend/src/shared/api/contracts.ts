export interface Operation {
  display_name?: string;
  order_display_name?: string;
  id: string;
  order_id: string;
  machine_id: string;
  start: string;
  end: string;
  status: 'planned' | 'in_progress' | 'completed';
}
export interface Schedule {
  version: number;
  fingerprint: string;
  operations: Operation[];
}
export interface Failure {
  machine_id: string;
  started_at: string;
  recovered_at: string | null;
  source: string;
  received_at: string;
}
export interface Machine {
  id: string;
  name: string;
  capabilities: string[];
}
export interface Order {
  display_name?: string;
  id: string;
  name: string;
  due: string;
  priority: number;
}
export interface Decision {
  id: number;
  action: string;
  reason: string;
  created_at: string;
}
export interface PlanPublication {
  version: number;
  published_at: string | null;
  published_by: string | null;
  version_summary: string;
}
export interface Workbench {
  event_history?: (Failure & { revision: number; created_at: string })[];
  plan_publication?: PlanPublication;
  baseline: Schedule;
  event: Failure;
  event_revision: number;
  snapshot_time: string;
  machines: Machine[];
  orders: Order[];
  affected: string[];
  issues: string[];
  history: Decision[];
}
export interface Change {
  工序: string;
  订单: string;
  类型: string;
  原设备: string;
  新设备: string;
  原开始: string;
  新开始: string;
  原结束: string;
  新结束: string;
  '时间变化(分钟)': number;
  依据: string;
  影响链: string;
}
export interface OrderImpact {
  订单: string;
  名称: string;
  交期: string;
  原完工: string;
  新完工: string;
  '原延期(分钟)': number;
  '新延期(分钟)': number;
  '新增延期(分钟)': number;
  判断: string;
}
export interface Candidate {
  id: string;
  label: string;
  schedule: Schedule;
  metrics: {
    late_orders: number;
    total_lateness_minutes: number;
    moved_operations: number;
    makespan: string;
  };
  evidence: string[];
  assumptions: string[];
  changes: Change[];
  order_impacts: OrderImpact[];
}
export interface Simulation {
  id: string;
  event_revision: number;
  baseline_fingerprint: string;
  candidates: Candidate[];
}

export interface SnapshotVersion {
  event_revision: number;
  baseline_fingerprint: string;
}

export interface SaveEventRequest extends SnapshotVersion {
  machine_id: string;
  started_at: string;
  recovered_at: string | null;
  source: string;
}

export interface DecisionRequest {
  simulation_id: string;
  candidate_id: string;
  action: 'publish' | 'reject';
  reason: string;
  request_id: string;
}

export interface DecisionResult {
  plan_version: number;
  workbench: Workbench;
}
export interface AnalysisResult {
  reports: Record<string, string>;
  mode: 'live' | 'offline';
}

export type WorkflowIntent = 'generate_candidates' | 're_evaluate' | 'explain' | 'validate';
export interface WorkflowNotice {
  code: string;
  message: string;
  repair_hint: string;
  evidence_refs: string[];
}
export interface WorkflowStatement {
  text: string;
  evidence_refs: string[];
}
export interface KnowledgeReport {
  status: 'matched' | 'no_match' | 'unavailable';
  mode: 'rules' | 'live' | 'fallback';
  message: string;
  sources: {
    chunk_id: string;
    document_id: string;
    title: string;
    version: string;
    section: string;
    excerpt: string;
    filename: string;
    kind: string;
    content_sha256: string;
  }[];
  items: {
    source_id: string;
    text: string;
    fact_ids: string[];
    related_facts: string[];
  }[];
  execution: {
    calls: number;
    model: string | null;
    error_code: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    elapsed_ms: number;
    prompt_sha256: string;
  };
}
export interface QualityIssue {
  code: string;
  message: string;
  repairable: boolean;
}
export interface QualityReport {
  version: string;
  outcome: 'passed' | 'warning' | 'blocked' | 'failed';
  round: number;
  issues: QualityIssue[];
  stop_reason: string | null;
  history: { round: number; issues: QualityIssue[]; repair: string | null }[];
}
export interface WorkflowReport {
  quality?: QualityReport | null;
  status: 'success' | 'warning' | 'blocked' | 'failed';
  warnings: WorkflowNotice[];
  errors: WorkflowNotice[];
  data: {
    summary?: string;
    facts?: WorkflowStatement[];
    assumptions?: WorkflowStatement[];
    risks?: WorkflowStatement[];
    tradeoffs?: WorkflowStatement[];
    next_steps?: {
      action: string;
      requires_human_confirmation: boolean;
      evidence_refs: string[];
    }[];
    limitations?: string[];
    evaluations?: {
      candidate_id: string;
      metrics_ref: string;
      differences_ref?: string;
      missing_metrics: string[];
    }[];
    candidates?: { candidate_id: string; strategy_id: string }[];
  } | null;
}
export interface WorkflowResult {
  trace_id?: string;
  created_at?: string;
  demo?: DemoFallbackStatus;
  id: string;
  intent: WorkflowIntent;
  status: 'completed' | 'blocked' | 'failed';
  failure_code: string | null;
  trace: {
    span_id?: string;
    elapsed_ms?: number | null;
    action: string;
    status: string;
    result_ref: string | null;
    error_code: string | null;
    knowledge?: KnowledgeReport | null;
    execution?: {
      mode: 'live' | 'fallback';
      model: string | null;
      calls: number;
      input_tokens: number | null;
      output_tokens: number | null;
      elapsed_ms: number;
      error_code: string | null;
      prompt_sha256: string;
      highlights: WorkflowStatement[];
      failure_phase?: string | null;
      failure_reason?: string | null;
      corrections?: { phase: string; reason: string }[];
      simulated?: boolean;
    } | null;
  }[];
  results: Partial<
    Record<'validation' | 'scheduling' | 'evaluation' | 'explanation', WorkflowReport>
  >;
  evidence_catalog: Record<string, { kind: string; content: unknown }>;
}
export interface WorkflowResponse {
  workflow: WorkflowResult;
  simulation: Simulation | null;
}

export interface DemoFallbackStatus {
  available: boolean;
  remaining_seconds: number;
  retry_at: string | null;
}

export type WorkflowAction = 'validate' | 'schedule' | 'evaluate' | 'explain';
export type WorkflowProgressEvent =
  | { type: 'trace_started'; trace_id: string }
  | { type: 'plan'; actions: WorkflowAction[] }
  | { type: 'stage_started'; action: WorkflowAction }
  | {
      type: 'quality_phase';
      action: WorkflowAction;
      phase: 'executing' | 'checking' | 'repairing';
      round: number;
    }
  | {
      type: 'quality_checked';
      action: WorkflowAction;
      round: number;
      outcome: 'passed' | 'failed';
      issues: QualityIssue[];
    }
  | {
      type: 'stage_completed';
      action: WorkflowAction;
      name: keyof WorkflowResult['results'];
      report: WorkflowReport | null;
      step: WorkflowResult['trace'][number];
    };
export interface WorkflowProgress {
  trace_id?: string;
  quality?: {
    action: WorkflowAction;
    phase: 'executing' | 'checking' | 'repairing' | 'checked';
    round: number;
  } | null;
  intent: WorkflowIntent;
  actions: WorkflowAction[];
  active: WorkflowAction | null;
  trace: WorkflowResult['trace'];
  results: WorkflowResult['results'];
  interrupted: boolean;
  cancelled?: boolean;
}

export interface SalesProduct {
  id: string;
  name: string;
  material: string;
  units_per_cycle: number;
  cycle_seconds: number;
  buffer_percent: number;
}
export interface SalesOverview {
  plan_version: number;
  plan_fingerprint: string;
  snapshot_time: string;
  source: string;
  product_source: string;
  products: SalesProduct[];
  orders: {
    display_name?: string;
    id: string;
    name: string;
    due: string;
    planned_completion: string | null;
    lateness_minutes: number | null;
  }[];
}
export interface ProcessingEstimate {
  product_id: string;
  quantity: number;
  cycles: number;
  theoretical_seconds: number;
  buffer_percent: number;
  buffer_seconds: number;
  planned_minutes: number;
  source: string;
}

export interface InsertionRequestCreate {
  product_id: string;
  quantity: number;
  earliest_start_at: string;
  requested_due_at: string;
  reason: string;
  submission_key: string;
}
export interface InsertionRequestRecord {
  id: string;
  request_no: string;
  assigned_planner: string;
  status: 'pending_approval' | 'approved' | 'rejected' | 'published';
  product_id: string;
  quantity: number;
  earliest_start_at: string;
  requested_due_at: string;
  reason: string;
  plan_version: number;
  estimate: ProcessingEstimate;
  assessment?: InsertionAssessment | null;
  assessment_stale?: boolean;
  approval?: { status: string; reason?: string; assessment_id?: string } | null;
  status_history?: {
    from_status: string;
    to_status: string;
    operator_role: string;
    comment: string;
    created_at: string;
  }[];
  created_at: string;
}

export interface InsertionAssessment {
  request_no?: string;
  assessment_id?: string;
  workflow?: {
    trace_id?: string;
    mode: string;
    trace: {
      span_id?: string;
      elapsed_ms?: number;
      agent: string;
      status: string;
      mode: string;
      execution?: {
        mode: string;
        model: string | null;
        calls: number;
        input_tokens?: number | null;
        output_tokens?: number | null;
        elapsed_ms: number;
        error_code: string | null;
        highlights: { text: string; evidence_refs: string[] }[];
      };
    }[];
    explanation: {
      facts: string[];
      risks: string[];
      limitations: string[];
      next_steps: string[];
      knowledge?: KnowledgeReport | null;
    };
  };
  request_id: string;
  baseline_version: number;
  baseline_fingerprint: string;
  event_revision: number;
  tool_version: string;
  created_at: string;
  summary: {
    estimated_completion_at: string;
    meets_due: boolean;
    affected_order_count: number;
    newly_delayed_order_count: number;
    order_impacts: {
      order_id: string;
      order_name: string;
      due: string;
      original_completion_at: string;
      projected_completion_at: string;
      original_lateness_minutes: number;
      projected_lateness_minutes: number;
      delay_delta_minutes: number;
      completion_changed: boolean;
    }[];
  };
  details: {
    inserted_order_id: string;
    process_steps: { sequence: number; name: string }[];
    operations: {
      operation_id: string;
      display_name?: string;
      order_display_name?: string;
      order_id: string;
      sequence: number;
      machine_id: string;
      mold_id: string;
      capability: string;
      status: string;
      start: string;
      end: string;
      duration_minutes: number;
      setup_minutes: number;
      setup_start: string;
    }[];
  };
  assumptions: string[];
  baseline_resource_issues: string[];
}
