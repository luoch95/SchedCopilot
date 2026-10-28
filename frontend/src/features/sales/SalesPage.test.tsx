import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SalesPage } from './SalesPage';
import type {
  InsertionAssessment,
  InsertionRequestRecord,
  SalesOverview,
} from '../../shared/api/contracts';
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
const presetAssessment: InsertionAssessment = {
  request_id: 'preset',
  baseline_version: 1,
  baseline_fingerprint: 'plan-1',
  event_revision: 1,
  tool_version: 'rules',
  created_at: '2026-10-19T13:00:00+08:00',
  summary: {
    estimated_completion_at: '2026-10-19T16:00:00+08:00',
    meets_due: true,
    affected_order_count: 0,
    newly_delayed_order_count: 0,
    order_impacts: [],
  },
  details: { inserted_order_id: 'URG-preset', process_steps: [], operations: [] },
  assumptions: [],
  baseline_resource_issues: [],
};
function preset(): InsertionRequestRecord {
  return {
    id: 'preset',
    request_no: 'URG-20261020-001',
    product_id: 'P-DEMO-001',
    quantity: 1001,
    earliest_start_at: '2026-10-19T05:00:00Z',
    requested_due_at: '2026-10-20T08:00:00Z',
    reason: '预置紧急补货',
    assigned_planner: 'planner_01',
    status: 'pending_approval',
    plan_version: 1,
    estimate,
    assessment: presetAssessment,
    created_at: '2026-10-19T13:00:00+08:00',
  };
}
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
          assigned_planner: 'planner_01',
          status: body.draft_only ? 'draft' : 'pending_approval',
          plan_version: 1,
          estimate,
          created_at: '2026-10-19T13:00:00+08:00',
        };
        savedRequests = [record];
        data = record;
      } else if (
        url === '/api/sales/requests' ||
        url === '/api/sales/requests?assigned_planner=planner_01'
      )
        data = savedRequests;
      else if (url.endsWith('/assessment')) {
        const record = savedRequests.find((item) => url.includes(item.request_no))!;
        record.assessment = {
          ...presetAssessment,
          request_id: record.id,
          assessment_id: 'assessment-1',
        };
        data = record.assessment;
      } else if (url.endsWith('/actions')) {
        const record = savedRequests.find((item) => url.includes(item.request_no))!;
        record.status = 'pending_approval';
        data = record;
      } else if (url.startsWith('/api/sales/requests/'))
        data = savedRequests.find((record) => url.endsWith('/' + record.request_no));
      else if (url === '/api/demo/session') data = { admin: true, read_only: false };
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
    expect((screen.getByRole('button', { name: '评估插单' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
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
  it('shows actual streamed stages while assessment is still running', async () => {
    await openPage();
    fill();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((url, options) =>
      String(url).endsWith('/assessment')
        ? Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start(value) {
                  controller = value;
                },
              }),
              { headers: { 'Content-Type': 'application/x-ndjson' } },
            ),
          )
        : original(url, options),
    );
    fireEvent.click(screen.getByRole('button', { name: '评估插单' }));
    const chain = await screen.findByRole('region', { name: '插单评估链路' });
    await waitFor(() => expect(controller).toBeTruthy());
    const send = (event: unknown) =>
      controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'));
    send({ type: 'insertion_stage_started', agent: 'validation' });
    await within(chain).findByText('正在数据校验…');
    expect(within(chain).getByText('方案评估').closest('li')?.dataset.status).toBe('waiting');
    for (const agent of ['validation', 'scheduling', 'evaluation', 'explanation']) {
      if (agent !== 'validation') send({ type: 'insertion_stage_started', agent });
      send({
        type: 'insertion_stage_completed',
        agent,
        mode: agent === 'explanation' ? 'fallback' : 'rules',
      });
    }
    send({ type: 'insertion_stage_started', agent: 'saving' });
    await within(chain).findByText('正在保存评估结果…');
    expect(
      (screen.getByRole('button', { name: '提交管理者审批' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    savedRequests[0].assessment = { ...presetAssessment, assessment_id: 'streamed' };
    send({ type: 'insertion_stage_completed', agent: 'saving' });
    send({ type: 'result', data: savedRequests[0].assessment });
    controller.close();
    await within(chain).findByText('评估结果已保存，可查看摘要后提交审批。');
    expect(within(chain).getAllByText('已完成')).toHaveLength(5);
    expect(screen.getByRole('button', { name: '重新评估' })).toBeTruthy();
    expect(within(chain).getByText('已降级为规则结果')).toBeTruthy();
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: '提交管理者审批' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText('数量（件）'), { target: { value: '1002' } });
    expect(screen.queryByRole('region', { name: '插单评估链路' })).toBeNull();
    expect(screen.getByRole('button', { name: '评估插单' })).toBeTruthy();
  });

  it('retains the failed stage and leaves later stages waiting', async () => {
    await openPage();
    fill();
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((url, options) =>
      String(url).endsWith('/assessment')
        ? Promise.resolve(
            new Response(
              [
                { type: 'insertion_stage_started', agent: 'validation' },
                { type: 'insertion_stage_completed', agent: 'validation', mode: 'rules' },
                { type: 'insertion_stage_started', agent: 'scheduling' },
                { type: 'insertion_stage_failed', agent: 'scheduling' },
                { type: 'error', status: 409, detail: '当前班次内无可用时段' },
              ]
                .map((event) => JSON.stringify(event))
                .join('\n'),
              { headers: { 'Content-Type': 'application/x-ndjson' } },
            ),
          )
        : original(url, options),
    );
    fireEvent.click(screen.getByRole('button', { name: '评估插单' }));
    await screen.findByText('插单评估失败：当前班次内无可用时段');
    const chain = screen.getByRole('region', { name: '插单评估链路' });
    expect(within(chain).getByText('数据校验').closest('li')?.dataset.status).toBe('completed');
    expect(within(chain).getByText('排产试算').closest('li')?.dataset.status).toBe('failed');
    expect(within(chain).getByText('结果解释').closest('li')?.dataset.status).toBe('waiting');
    expect(
      (screen.getByRole('button', { name: '提交管理者审批' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('restores the preset form in guest mode, then unlocks, estimates and submits it', async () => {
    savedRequests = [preset()];
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /进入业务员页面/ }));
    await screen.findByText('申请：URG-20261020-001');
    expect((screen.getByLabelText('模拟产品') as HTMLSelectElement).value).toBe('P-DEMO-001');
    expect((screen.getByLabelText('数量（件）') as HTMLInputElement).value).toBe('1001');
    expect((screen.getByLabelText('最早开工时间（北京时间）') as HTMLInputElement).value).toBe(
      '2026-10-19T13:00',
    );
    expect((screen.getByLabelText('要求交期（北京时间）') as HTMLInputElement).value).toBe(
      '2026-10-20T16:00',
    );
    expect((screen.getByLabelText('紧急原因') as HTMLTextAreaElement).value).toBe('预置紧急补货');
    expect(screen.getByLabelText('模拟产品').closest('fieldset')?.disabled).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: '解锁' }).at(-1)!);
    fireEvent.change(screen.getByLabelText('演示密码'), { target: { value: 'admin123' } });
    fireEvent.click(screen.getAllByRole('button', { name: '解锁' }).at(-1)!);
    await screen.findByText('✓ 已解锁操作权限');
    fireEvent.click(screen.getByRole('button', { name: '评估插单' }));
    await screen.findByRole('heading', { name: '加工时长预估' });
    fireEvent.click(screen.getByRole('button', { name: '提交管理者审批' }));
    await screen.findByText('申请 URG-TEST-0001 已保存，待审批。');
    expect((screen.getByLabelText('紧急原因') as HTMLTextAreaElement).value).toBe('预置紧急补货');
  });

  it('clears the historical summary when editing a restored request', async () => {
    savedRequests = [preset()];
    await openPage();
    await screen.findByText('申请：URG-20261020-001');
    fireEvent.change(screen.getByLabelText('数量（件）'), { target: { value: '200' } });
    expect(screen.queryByText('申请：URG-20261020-001')).toBeNull();
    expect(screen.getAllByText('待评估')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '刷新概况' }));
    await screen.findByText('本地仿真排产计划');
    expect((screen.getByLabelText('数量（件）') as HTMLInputElement).value).toBe('200');
    fireEvent.click(screen.getByRole('button', { name: '刷新申请' }));
    await screen.findByText('URG-20261020-001');
    expect((screen.getByLabelText('数量（件）') as HTMLInputElement).value).toBe('200');
  });

  it('shows the published request number instead of its internal order ID', async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((url, options) =>
      url === '/api/sales/overview'
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                ...overview,
                orders: [
                  {
                    ...overview.orders[0],
                    id: 'URG-b2144663-1234-4321-8765-abcdef012345',
                    display_name: 'URG-20261020-001',
                  },
                ],
              }),
            ),
          )
        : original(url, options),
    );
    await openPage();
    expect(screen.getByText('URG-20261020-001 · 原订单')).toBeTruthy();
    expect(document.body.textContent).not.toContain('b2144663');
  });
  it('resolves a legacy overview UUID from request_no, including UUIDs in order names', async () => {
    const id = 'b2144663-8800-4db4-9bcb-647e6594b8bb';
    savedRequests = [{ ...preset(), id, status: 'published' }];
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((url, options) =>
      url === '/api/sales/overview'
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                ...overview,
                orders: [{ ...overview.orders[0], id: `URG-${id}`, name: `插单 URG-${id}` }],
              }),
            ),
          )
        : original(url, options),
    );
    await openPage();
    expect(screen.getByText('URG-20261020-001 · 插单 URG-20261020-001')).toBeTruthy();
    expect(document.body.textContent).not.toContain(id);
  });
  it('never falls back to UUID when request metadata is unavailable', async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((url, options) =>
      url === '/api/sales/overview'
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                ...overview,
                orders: [{ ...overview.orders[0], id: 'URG-b2144663-8800-4db4-9bcb-647e6594b8bb' }],
              }),
            ),
          )
        : original(url, options),
    );
    await openPage();
    expect(screen.getByText('单号待同步 · 原订单')).toBeTruthy();
    expect(document.body.textContent).not.toContain('b2144663');
  });
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
      (screen.getByRole('button', { name: '提交管理者审批' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByText(/M1|M2|MD-A/)).toBeNull();
    expect(calls.map((call) => call.url).sort()).toEqual([
      '/api/sales/overview',
      '/api/sales/requests',
    ]);
  });
  it('validates missing fields before making an estimate request', async () => {
    await openPage();
    fireEvent.click(screen.getByRole('button', { name: '评估插单' }));
    expect(screen.getByRole('alert').textContent).toContain('请修正');
    expect(calls.filter((call) => call.url !== '/api/sales/requests')).toHaveLength(1);
  });
  it('estimates using server parameters and clears the old preview after an edit', async () => {
    await openPage();
    fill();
    fireEvent.click(screen.getByRole('button', { name: '评估插单' }));
    await screen.findByRole('heading', { name: '加工时长预估' });
    expect(screen.getByText('414 分钟')).toBeTruthy();
    expect(screen.getByText('经验冗余（10%）')).toBeTruthy();
    expect(screen.getByText('已完成试排评估；审批与发布需另行操作。')).toBeTruthy();
    expect(
      calls.find((call) => call.url === '/api/sales/requests' && call.body)?.body,
    ).toMatchObject({ product_id: 'P-DEMO-001', quantity: 1001, draft_only: true });
    expect(calls.some((call) => call.url.endsWith('/assessment'))).toBe(true);
    expect(savedRequests[0].status).toBe('draft');
    expect(calls.some((call) => call.url.endsWith('/actions'))).toBe(false);
    fireEvent.change(screen.getByLabelText('数量（件）'), { target: { value: '1002' } });
    expect(screen.queryByRole('heading', { name: '加工时长预估' })).toBeNull();
    expect(
      (screen.getByRole('button', { name: '提交管理者审批' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getAllByText('待评估')).toHaveLength(3);
    expect(calls.every((call) => call.url.startsWith('/api/sales/'))).toBe(true);
  });
  it('submits one persisted pending approval after the estimate', async () => {
    await openPage();
    fill();
    fireEvent.click(screen.getByRole('button', { name: '评估插单' }));
    await screen.findByRole('heading', { name: '加工时长预估' });
    fireEvent.click(screen.getByRole('button', { name: '提交管理者审批' }));
    await screen.findByText(/申请 URG-/);
    const request = calls.find((call) => call.url === '/api/sales/requests' && call.body);
    expect(request?.body).toMatchObject({
      product_id: 'P-DEMO-001',
      quantity: 1001,
      reason: '客户紧急补货',
      draft_only: true,
    });
    expect(calls.find((call) => call.url.endsWith('/actions'))?.body).toMatchObject({
      action: 'submit',
      operator_role: 'sales',
      assessment_id: 'assessment-1',
    });
    expect(calls.filter((call) => call.url.endsWith('/assessment'))).toHaveLength(1);
  });
  it('restores submitted requests after remount and shows them in the real planner workbench', async () => {
    const first = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /进入业务员页面/ }));
    await screen.findByText('本地仿真排产计划');
    fireEvent.click(screen.getAllByRole('button', { name: '解锁' }).at(-1)!);
    fireEvent.change(screen.getByLabelText('演示密码'), { target: { value: 'admin123' } });
    fireEvent.click(screen.getAllByRole('button', { name: '解锁' }).at(-1)!);
    fill();
    fireEvent.click(screen.getByRole('button', { name: '评估插单' }));
    await screen.findByRole('heading', { name: '加工时长预估' });
    fireEvent.click(screen.getByRole('button', { name: '提交管理者审批' }));
    await screen.findByText('URG-TEST-0001');
    first.unmount();
    render(<App />);
    await screen.findByText('URG-TEST-0001');
    expect(screen.getByText('待审批 · 已试排')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '切换角色' }));
    await screen.findByRole('heading', { name: '选择你的工作角色' });
    fireEvent.click(screen.getByRole('button', { name: /进入排产工作台/ }));
    await screen.findByRole('heading', { name: '排产计划工作台' });
    await screen.findByText('URG-TEST-0001');
    expect(savedRequests).toHaveLength(1);
  });
  it('retries failed submissions with the same key and shows no false success', async () => {
    await openPage();
    fill();
    fireEvent.click(screen.getByRole('button', { name: '评估插单' }));
    await screen.findByRole('heading', { name: '加工时长预估' });
    let actionBody: unknown;
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementationOnce(async (url, options) => {
      expect(url).toBe('/api/sales/requests/URG-TEST-0001/actions');
      actionBody = JSON.parse(String(options?.body));
      throw new TypeError('network error');
    });
    fireEvent.click(screen.getByRole('button', { name: '提交管理者审批' }));
    await screen.findByText(/提交失败，请重试/);
    expect(screen.queryByText('申请 URG-TEST-0001 已保存，待审批。')).toBeNull();
    vi.mocked(fetch).mockImplementation(original);
    fireEvent.click(screen.getByRole('button', { name: '提交管理者审批' }));
    await screen.findByText('URG-TEST-0001');
    expect(calls.find((call) => call.url.endsWith('/actions'))?.body).toEqual(actionBody);
  });
  it('rejects fractional quantities and a deadline before the start', async () => {
    await openPage();
    fill();
    fireEvent.change(screen.getByLabelText('数量（件）'), { target: { value: '1.5' } });
    fireEvent.change(screen.getByLabelText('要求交期（北京时间）'), {
      target: { value: '2026-10-19T11:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: '评估插单' }));
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
    fireEvent.click(screen.getByRole('button', { name: '评估插单' }));
    await screen.findByText(/插单评估失败：/);
    expect(screen.queryByRole('heading', { name: '加工时长预估' })).toBeNull();
  });

  it('keeps a failed assessment as a draft and blocks submission', async () => {
    await openPage();
    fill();
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((url, options) =>
      String(url).endsWith('/assessment')
        ? Promise.resolve(
            new Response(JSON.stringify({ detail: '当前班次内无可用时段' }), { status: 409 }),
          )
        : original(url, options),
    );
    fireEvent.click(screen.getByRole('button', { name: '评估插单' }));
    await screen.findByText('插单评估失败：当前班次内无可用时段');
    expect(savedRequests[0].status).toBe('draft');
    expect(
      (screen.getByRole('button', { name: '提交管理者审批' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getAllByText('待评估')).toHaveLength(3);
    expect(calls.some((call) => call.url.endsWith('/actions'))).toBe(false);
  });
});

it('places request records above the form and starts a clean draft', async () => {
  savedRequests = [preset()];
  await openPage();
  await screen.findByText('申请：URG-20261020-001');
  const records = screen.getByRole('region', { name: '插单申请记录' });
  const form = screen.getByRole('region', { name: '插单需求' });
  expect(records.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '新建插单' }));
  expect((screen.getByLabelText('模拟产品') as HTMLSelectElement).value).toBe('');
  expect((screen.getByLabelText('数量（件）') as HTMLInputElement).value).toBe('');
  expect(document.activeElement).toBe(screen.getByLabelText('模拟产品'));
  expect(screen.queryByText('申请：URG-20261020-001')).toBeNull();
});

it('opens the submitted request from its success message and can reopen it', async () => {
  await openPage();
  fill();
  fireEvent.click(screen.getByRole('button', { name: '评估插单' }));
  await screen.findByRole('heading', { name: '加工时长预估' });
  fireEvent.click(screen.getByRole('button', { name: '提交管理者审批' }));
  await screen.findByText('申请 URG-TEST-0001 已保存，待审批。');
  const success = screen.getByText('申请 URG-TEST-0001 已保存，待审批。').parentElement!;
  fireEvent.click(within(success).getByRole('button', { name: '查看详情' }));
  const drawer = await screen.findByRole('dialog', { name: '插单申请详情' });
  expect(await within(drawer).findByText('申请业务员：未记录')).toBeTruthy();
  fireEvent.click(within(drawer).getByRole('button', { name: '关闭' }));
  fireEvent.click(within(success).getByRole('button', { name: '查看详情' }));
  expect(await screen.findByRole('dialog', { name: '插单申请详情' })).toBeTruthy();
  expect(calls.filter((call) => call.url === '/api/sales/requests' && call.body)).toHaveLength(1);
});
