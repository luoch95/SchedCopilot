import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { localInput } from '../shared/lib/time';
import { workbench, simulation } from '../test/fixtures';

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

  it('saves unknown recovery and restores a usable event without losing the plan', async () => {
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      const response = await baseFetch(...args);
      if (args[0] === '/api/event')
        return new Response(
          JSON.stringify({
            ...workbench,
            event_revision: 2,
            event: { ...workbench.event, recovered_at: null },
          }),
          { status: 200 },
        );
      return response;
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    await user.click(screen.getByLabelText('恢复时间未知'));
    expect(screen.queryByLabelText('预计恢复时间')).toBeNull();
    await user.click(screen.getByRole('button', { name: '保存故障事件' }));
    await screen.findByText('故障事件已保存。请重新生成候选方案，正式计划未改变。');
    expect(
      (screen.getByRole('button', { name: /生成候选方案/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(calls.find((call) => call.path === '/api/event')!.body!.recovered_at).toBeNull();
    await user.click(screen.getByRole('button', { name: '恢复上次可试算事件' }));
    await screen.findByText('已恢复可试算事件。正式计划与历史记录均保留。');
    expect(screen.getByLabelText('预计恢复时间')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByRole('heading', { name: '方案比较' });
  });

  it('records a rejection while preserving the visible comparison and formal plan', async () => {
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      const response = await baseFetch(...args);
      if (args[0] === '/api/decisions')
        return new Response(
          JSON.stringify({
            plan_version: 1,
            workbench: {
              ...workbench,
              history: [
                {
                  id: 1,
                  action: 'reject',
                  reason: '等待维修确认',
                  created_at: workbench.snapshot_time,
                },
              ],
            },
          }),
          { status: 200 },
        );
      return response;
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByRole('heading', { name: '方案比较' });
    await user.type(screen.getByLabelText('确认理由（必填）'), '等待维修确认');
    await user.click(screen.getByRole('button', { name: '记录暂不发布' }));
    await screen.findByText('已记录暂不发布，正式计划保持不变。');
    expect(screen.getByRole('heading', { name: '方案比较' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '等待维修确认' })).toBeTruthy();
    expect(calls.find((call) => call.path === '/api/decisions')!.body!.action).toBe('reject');
  });

  it('reuses the idempotency key when retrying a failed publication response', async () => {
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    let lostResponse = false;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      if (args[0] === '/api/decisions' && !lostResponse) {
        lostResponse = true;
        calls.push({ path: '/api/decisions', body: JSON.parse(String(args[1]?.body)) });
        throw new TypeError('connection lost');
      }
      return baseFetch(...args);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByRole('heading', { name: '方案比较' });
    await user.selectOptions(screen.getByLabelText('本次处理的方案'), 'transfer');
    await user.selectOptions(screen.getByLabelText('处理方式'), 'publish');
    await user.type(screen.getByLabelText('确认理由（必填）'), '确认转移');
    await user.click(screen.getByRole('button', { name: '确认并发布所选方案' }));
    await screen.findByText('无法连接后端。请确认 FastAPI 已在 8000 端口启动。');
    await user.click(screen.getByRole('button', { name: '确认并发布所选方案' }));
    await screen.findByText('已发布方案，正式计划版本 V2。');
    const decisions = calls.filter((call) => call.path === '/api/decisions');
    expect(decisions).toHaveLength(2);
    expect(decisions[0].body!.request_id).toBe(decisions[1].body!.request_id);
  });
});
