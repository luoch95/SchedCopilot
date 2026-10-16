import type { Candidate, Simulation, Workbench } from '../shared/api/contracts';

const start = '2026-10-19T13:00:00+08:00';
export const workbench: Workbench = {
  baseline: {
    version: 1,
    fingerprint: 'plan-1',
    operations: [
      {
        id: 'O1-OP1',
        order_id: 'O1',
        machine_id: 'M1',
        start,
        end: '2026-10-19T14:00:00+08:00',
        status: 'planned',
      },
    ],
  },
  event: {
    machine_id: 'M1',
    started_at: start,
    recovered_at: '2026-10-19T17:00:00+08:00',
    source: '维修班组',
    received_at: start,
  },
  event_revision: 1,
  snapshot_time: start,
  machines: [
    { id: 'M1', name: '车床一', capabilities: ['turn'] },
    { id: 'M2', name: '车床二', capabilities: ['turn'] },
  ],
  orders: [{ id: 'O1', name: '零件', due: '2026-10-19T16:00:00+08:00', priority: 1 }],
  affected: ['O1-OP1'],
  issues: [],
  history: [],
};
function candidate(id: string, transfer: boolean): Candidate {
  const op = {
    ...workbench.baseline.operations[0],
    machine_id: transfer ? 'M2' : 'M1',
    start: transfer ? start : '2026-10-19T17:00:00+08:00',
    end: transfer ? '2026-10-19T14:00:00+08:00' : '2026-10-19T18:00:00+08:00',
  };
  return {
    id,
    label: transfer ? '允许合格设备转移' : '等待修复',
    schedule: { version: 2, fingerprint: id, operations: [op] },
    metrics: {
      late_orders: transfer ? 0 : 1,
      total_lateness_minutes: transfer ? 0 : 120,
      moved_operations: 1,
      makespan: op.end,
    },
    evidence: ['故障窗口与待加工工序重叠'],
    assumptions: ['人工估计恢复时间'],
    changes: [],
    order_impacts: [
      {
        订单: 'O1',
        名称: '零件',
        交期: workbench.orders[0].due,
        原完工: workbench.baseline.operations[0].end,
        新完工: op.end,
        '原延期(分钟)': 0,
        '新延期(分钟)': transfer ? 0 : 120,
        '新增延期(分钟)': transfer ? 0 : 120,
        判断: transfer ? '未变化' : '新增延期',
      },
    ],
  };
}
export const simulation: Simulation = {
  id: 'batch-1',
  event_revision: 1,
  baseline_fingerprint: 'plan-1',
  candidates: [candidate('wait', false), candidate('transfer', true)],
};
