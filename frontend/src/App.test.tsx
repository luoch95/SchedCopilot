import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { localInput } from './api';
import type { Candidate, Simulation, Workbench } from './types';

const start = '2026-10-19T13:00:00+08:00';
const workbench: Workbench = {
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
const simulation: Simulation = {
  id: 'batch-1',
  event_revision: 1,
  baseline_fingerprint: 'plan-1',
  candidates: [candidate('wait', false), candidate('transfer', true)],
};
let calls: { path: string; body?: Record<string, unknown> }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      const body = options?.body ? JSON.parse(String(options.body)) : undefined;
      calls.push({ path: url, body });
      let data: unknown = workbench;
      if (url === '/api/simulations') data = simulation;
      if (url === '/api/decisions')
        data = {
          plan_version: 2,
          workbench: { ...workbench, baseline: simulation.candidates[1].schedule },
        };
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

describe('Schedule Copilot workflow', () => {
  it('shows both candidates and publishes only a server-owned candidate identifier', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByRole('heading', { name: '方案比较' });
    expect(screen.getAllByRole('img', { name: '设备工序甘特图' })).toHaveLength(3);
    expect(document.querySelectorAll('rect[stroke="#7C3AED"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.evidence-cell')).toHaveLength(4);
    await user.selectOptions(screen.getByLabelText('本次处理的方案'), 'transfer');
    await user.selectOptions(screen.getByLabelText('处理方式'), 'publish');
    await user.type(screen.getByLabelText('确认理由（必填）'), '接受设备转移');
    await user.click(screen.getByRole('button', { name: '确认并发布所选方案' }));
    await screen.findByText('已发布方案，正式计划版本 V2。');
    const decision = calls.find((call) => call.path === '/api/decisions')!.body!;
    expect(decision.candidate_id).toBe('transfer');
    expect(decision.simulation_id).toBe('batch-1');
    expect(decision).not.toHaveProperty('schedule');
    expect(screen.queryByRole('heading', { name: '方案比较' })).toBeNull();
  });

  it('invalidates visible candidates immediately on unsaved event edits', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByRole('heading', { name: '方案比较' });
    fireEvent.change(screen.getByLabelText('预计恢复时间'), {
      target: { value: '2026-10-19T18:00' },
    });
    expect(screen.queryByRole('heading', { name: '方案比较' })).toBeNull();
    expect(
      (screen.getByRole('button', { name: /生成候选方案/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: '保存故障事件' }));
    await waitFor(() => expect(calls.some((call) => call.path === '/api/event')).toBe(true));
    const saved = calls.find((call) => call.path === '/api/event')!.body!;
    expect(saved.event_revision).toBe(1);
    expect(saved.recovered_at).toBe('2026-10-19T18:00:00+08:00');
  });

  it('surfaces stale versions and requires reload before continuing', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: '事件或计划已更新，请重新载入后操作' }), {
        status: 409,
      }),
    );
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByText('后台事件或计划已更新，请点击“重新载入已保存事件”后继续。');
    expect(
      (screen.getByRole('button', { name: /生成候选方案/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: '重新载入已保存事件' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: /生成候选方案/ }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });

  it('always formats editor times in the workshop timezone', () => {
    expect(localInput('2026-10-19T05:00:00Z')).toBe('2026-10-19T13:00');
  });
});
