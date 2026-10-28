export interface DiagnosticSpan {
  id: string;
  name: string;
  kind: string;
  parent_id: string | null;
  started_at: string;
  ended_at: string;
  status: string;
  elapsed_ms: number;
  mode?: string;
  model?: string | null;
  error_code?: string;
  input_tokens?: number;
  output_tokens?: number;
  corrections?: number | null;
  failure_phase?: string | null;
}

export interface DiagnosticRun {
  id: string;
  business_type: 'fault' | 'insertion';
  business_id?: string;
  workflow_id?: string;
  assessment_id?: string;
  local_trace_id?: string;
  plan_version?: number;
  event_revision?: number;
  input_fingerprint?: string;
  started_at: string;
  ended_at: string;
  status: string;
  elapsed_ms: number;
  mode: string;
  model_calls: number;
  input_tokens: number | null;
  output_tokens: number | null;
  error_code?: string;
  upload_status: string;
  upload_error?: string;
  langsmith_url?: string;
  spans: DiagnosticSpan[];
}

export interface DiagnosticPage {
  items: DiagnosticRun[];
  total: number;
  page: number;
}
