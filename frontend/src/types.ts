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
