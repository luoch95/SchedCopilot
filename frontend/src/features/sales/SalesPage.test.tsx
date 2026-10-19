import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SalesPage } from './SalesPage';
import type { InsertionRequestRecord, SalesOverview } from '../../shared/api/contracts';
import App from '../../app/App';
import { workbench } from '../../test/fixtures';

const overview: SalesOverview = {
  plan_version: 1,
  plan_fingerprint: 'plan-1',
  snapshot_time: '2026-10-19T12:00:00+08:00',
  source: '本地仿真排产计划',
  product_source: '模拟产品参数；演示经验值',
  products: [
    {
      id: 'P-DEMO-001',
      name: '仪表外壳',
      material: 'ABS',
      units_per_cycle: 2,
      cycle_seconds: 45,
      buffer_percent: 10,
    },
  ],
  orders: [
    {
      id: 'O1001',
      name: '原订单',
      due: '2026-10-19T16:00:00+08:00',
      planned_completion: '2026-10-19T17:00:00+08:00',
      lateness_minutes: 60,
    },
  ],
};
const estimate = {
  product_id: 'P-DEMO-001',
  quantity: 1001,
  cycles: 501,
  theoretical_seconds: 22545,
  buffer_percent: 10,
  buffer_seconds: 2254.5,
  planned_minutes: 414,
  source: '演示经验值',
};
let calls: { url: string; body?: unknown }[];
let savedRequests: InsertionRequestRecord[];
beforeEach(() => {
  calls = [];
  savedRequests = [];
  sessionStorage.clear();
  history.replaceState(null, '');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      const body = options?.body ? JSON.parse(String(options.body)) : undefined;
      calls.push({ url, body });
      let data: unknown;
      if (url === '/api/sales/requests' && body) {
        const record: InsertionRequestRecord = {
          ...body,
          id: 'persisted-request',
          request_no: 'URG-TEST-0001',
          status: 'pending_approval',
          plan_version: 1,
          estimate,
          created_at: '2026-10-19T13:00:00+08:00',
        };
        savedRequests = [record];
        data = record;
      } else if (url === '/api/sales/requests') data = savedRequests;
      else if (url === '/api/sales/overview') data = overview;
      else if (url === '/api/sales/processing-estimate') data = estimate;
      else if (url === '/api/workbench') data = workbench;
      else if (url === '/api/workflow/demo')
        data = { available: true, remaining_seconds: 0, retry_at: null };
      else throw new Error(`Unexpected API: ${url}`);
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});
async function openPage() {
  render(<SalesPage onSwitchRole={vi.fn()} />);
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: '检查填写并预估加工时长' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
}
function fill() {
  fireEvent.change(screen.getByLabelText('模拟产品'), { target: { value: 'P-DEMO-001' } });
  fireEvent.change(screen.getByLabelText('数量（件）'), { target: { value: '1001' } });
  fireEvent.change(screen.getByLabelText('要求交期（北京时间）'), {
    target: { value: '2026-10-20T16:00' },
  });
  fireEvent.change(screen.getByLabelText('紧急原因'), { target: { value: '客户紧急补货' } });
}

describe('sales page framework (URG-02 / DISC-02)', () => {
  it('loads only the sales projection, shows no fake impacts or allocation, and keeps evaluation disabled', async () => {
    await openPage();
    fireEvent.click(screen.getByText('查看当前订单交期'));
    expect(screen.getByText('O1001 · 原订单')).toBeTruthy();
    expect(screen.getByText('60 分钟')).toBeTruthy();
    expect(
      screen.getByText('试排摘要仅供参考，具体设备与工序安排将由排产计划员复核发布'),
    ).toBeTruthy();
    expect(screen.getAllByText('待评估')).toHaveLength(3);
    expect(
      (screen.getByRole('button', { name: '提交领导审批' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByText(/M1|M2|MD-A/)).toBeNull();
    expect(calls.map((call) => call.url).sort()).toEqual([
      '/api/sales/overview',
      '/api/sales/requests',
    ]);
  });
  it('validates missing fields before making an estimate request', async () => {
    await openPage();
    fireEvent.click(screen.getByRole('button', { name: '检查填写并预估加工时长' }));
    expect(screen.getByRole('alert').textContent).toContain('请修正');
    expect(calls.filter((call) => call.url !== '/api/sales/requests')).toHaveLength(1);
  });
  it('estimates using server parameters and clears the old preview after an edit', async () => {
    await openPage();
    fill();
    fireEvent.click(screen.getByRole('button', { name: '检查填写并预估加工时长' }));
    await screen.findByRole('heading', { name: '加工时长预估' });
    expect(screen.getByText('414 分钟')).toBeTruthy();
    expect(screen.getByText('经验冗余（10%）')).toBeTruthy();
    expect(screen.getByText('填写检查通过，尚未试排。')).toBeTruthy();
    expect(calls.find((call) => call.url === '/api/sales/processing-estimate')).toEqual({
      url: '/api/sales/processing-estimate',
      body: { product_id: 'P-DEMO-001', quantity: 1001 },
    });
    fireEvent.change(screen.getByLabelText('数量（件）'), { target: { value: '1002' } });
    expect(screen.queryByRole('heading', { name: '加工时长预估' })).toBeNull();
    expect(calls.every((call) => call.url.startsWith('/api/sales/'))).toBe(true);
  });
  it('submits one persisted pending approval after the estimate', async () => {
    await openPage();
    fill();
    fireEvent.click(screen.getByRole('button', { name: '检查填写并预估加工时长' }));
    await screen.findByRole('heading', { name: '加工时长预估' });
    fireEvent.click(screen.getByRole('button', { name: '提交领导审批' }));
    await screen.findByText(/申请 URG-/);
    const request = calls.find((call) => call.url === '/api/sales/requests' && call.body);
    expect(request?.body).toMatchObject({
      product_id: 'P-DEMO-001',
      quantity: 1001,
      reason: '客户紧急补货',
    });
  });
  it('restores submitted requests after remount and shows them in the real planner workbench', async () => {
    const first = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /进入业务员页面/ }));
    await screen.findByText('本地仿真排产计划');
    fill();
    fireEvent.click(screen.getByRole('button', { name: '检查填写并预估加工时长' }));
    await screen.findByRole('heading', { name: '加工时长预估' });
    fireEvent.click(screen.getByRole('button', { name: '提交领导审批' }));
    await screen.findByText('URG-TEST-0001');
    first.unmount();
    render(<App />);
    await screen.findByText('URG-TEST-0001');
    expect(screen.getByText('待审批 · 未试排')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '切换角色' }));
    await screen.findByRole('heading', { name: '选择你的工作角色' });
    fireEvent.click(screen.getByRole('button', { name: /进入排产工作台/ }));
    await screen.findByRole('heading', { name: '故障影响与方案决策' });
    await screen.findByText('URG-TEST-0001');
    expect(savedRequests).toHaveLength(1);
  });
  it('retries failed submissions with the same key and shows no false success', async () => {
    await openPage();
    fill();
    fireEvent.click(screen.getByRole('button', { name: '检查填写并预估加工时长' }));
    await screen.findByRole('heading', { name: '加工时长预估' });
    let key = '';
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementationOnce(async (url, options) => {
      expect(url).toBe('/api/sales/requests');
      key = JSON.parse(String(options?.body)).submission_key;
      throw new TypeError('network error');
    });
    fireEvent.click(screen.getByRole('button', { name: '提交领导审批' }));
    await screen.findByText(/提交失败，请重试/);
    expect(screen.queryByText('URG-TEST-0001')).toBeNull();
    vi.mocked(fetch).mockImplementation(original);
    fireEvent.click(screen.getByRole('button', { name: '提交领导审批' }));
    await screen.findByText('URG-TEST-0001');
    expect(
      calls.find((call) => call.url === '/api/sales/requests' && call.body)?.body,
    ).toMatchObject({ submission_key: key });
  });
  it('rejects fractional quantities and a deadline before the start', async () => {
    await openPage();
    fill();
    fireEvent.change(screen.getByLabelText('数量（件）'), { target: { value: '1.5' } });
    fireEvent.change(screen.getByLabelText('要求交期（北京时间）'), {
      target: { value: '2026-10-19T11:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: '检查填写并预估加工时长' }));
    expect(screen.getByText('数量必须是 1 至 1000000 的整数。')).toBeTruthy();
    expect(screen.getByText('要求交期必须晚于最早开工时间。')).toBeTruthy();
    expect(calls.filter((call) => call.url !== '/api/sales/requests')).toHaveLength(1);
  });
  it('shows a recoverable load error instead of fabricated plan data', async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((url, options) =>
      url === '/api/sales/overview'
        ? Promise.reject(new TypeError('connection refused'))
        : original(url, options),
    );
    render(<SalesPage onSwitchRole={vi.fn()} />);
    await screen.findByRole('alert');
    expect(screen.queryByText('O1001 · 原订单')).toBeNull();
    vi.mocked(fetch).mockImplementation(original);
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await screen.findByText('本地仿真排产计划');
    expect(calls.filter((call) => call.url !== '/api/sales/requests')).toHaveLength(1);
  });
  it('shows estimate failures without manufacturing a result', async () => {
    await openPage();
    fill();
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('offline'));
    fireEvent.click(screen.getByRole('button', { name: '检查填写并预估加工时长' }));
    await screen.findByText('加工时长预估失败，请稍后重试。');
    expect(screen.queryByRole('heading', { name: '加工时长预估' })).toBeNull();
  });
});
