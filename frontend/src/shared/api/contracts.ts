export interface Operation {
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
export interface Workbench {
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
export interface WorkflowReport {
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
  id: string;
  intent: WorkflowIntent;
  status: 'completed' | 'blocked' | 'failed';
  failure_code: string | null;
  trace: {
    action: string;
    status: string;
    result_ref: string | null;
    error_code: string | null;
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

export type WorkflowAction = 'validate' | 'schedule' | 'evaluate' | 'explain';
export type WorkflowProgressEvent =
  | { type: 'plan'; actions: WorkflowAction[] }
  | { type: 'stage_started'; action: WorkflowAction }
  | {
      type: 'stage_completed';
      action: WorkflowAction;
      name: keyof WorkflowResult['results'];
      report: WorkflowReport | null;
      step: WorkflowResult['trace'][number];
    };
export interface WorkflowProgress {
  intent: WorkflowIntent;
  actions: WorkflowAction[];
  active: WorkflowAction | null;
  trace: WorkflowResult['trace'];
  results: WorkflowResult['results'];
  interrupted: boolean;
}
