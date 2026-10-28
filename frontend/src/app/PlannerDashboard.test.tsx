import { evidenceEntries } from './FaultDecisionEvidence';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import WorkbenchPage from './WorkbenchPage';
import App from './App';
import { PlannerInsertionComparison } from '../features/sales';
import { workbench, simulation } from '../test/fixtures';
import type { InsertionAssessment, InsertionRequestRecord } from '../shared/api/contracts';

afterEach(() => vi.useRealTimers());

const result: InsertionAssessment = {
  assessment_id: 'assessment-1',
  request_id: 'request-1',
  baseline_version: 1,
  baseline_fingerprint: 'plan-1',
  event_revision: 1,
  tool_version: 'insertion-rule-v1',
  created_at: '2026-10-19T13:00:00+08:00',
  summary: {
    estimated_completion_at: '2026-10-19T16:00:00+08:00',
    meets_due: true,
    affected_order_count: 1,
    newly_delayed_order_count: 0,
    order_impacts: [
      {
        order_id: 'O1001',
        order_name: '原订单',
        due: '2026-10-19T18:00:00+08:00',
        original_completion_at: '2026-10-19T15:00:00+08:00',
        projected_completion_at: '2026-10-19T17:00:00+08:00',
        original_lateness_minutes: 0,
        projected_lateness_minutes: 0,
        delay_delta_minutes: 0,
        completion_changed: true,
      },
    ],
  },
  details: {
    inserted_order_id: 'URG-request-1',
    process_steps: [{ sequence: 1, name: '注塑' }],
    operations: [
      {
        operation_id: 'URG-request-1-OP1',
        order_id: 'URG-request-1',
        sequence: 1,
        machine_id: 'M2',
        mold_id: 'MD-URG-A',
        capability: 'mold_a',
        status: 'planned',
        start: '2026-10-19T13:15:00+08:00',
        end: '2026-10-19T16:00:00+08:00',
        duration_minutes: 165,
        setup_minutes: 15,
        setup_start: '2026-10-19T13:00:00+08:00',
      },
    ],
  },
  assumptions: ['固定模拟数据，未发布'],
  baseline_resource_issues: [],
};
const request: InsertionRequestRecord = {
  id: 'request-1',
  request_no: 'URG-TEST-1',
  assigned_planner: 'planner_01',
  status: 'pending_approval',
  product_id: 'P-DEMO-001',
  quantity: 100,
  earliest_start_at: '2026-10-19T13:00:00+08:00',
  requested_due_at: '2026-10-20T16:00:00+08:00',
  reason: '紧急补货',
  plan_version: 1,
  created_at: '2026-10-19T13:00:00+08:00',
  estimate: {
    product_id: 'P-DEMO-001',
    quantity: 100,
    cycles: 50,
    theoretical_seconds: 2250,
    buffer_percent: 10,
    buffer_seconds: 225,
    planned_minutes: 42,
    source: '模拟',
  },
};

it('hides comparisons when the failure revision or resource freshness has changed', () => {
  const { rerender } = render(
    <PlannerInsertionComparison
      record={{ ...request, assessment: result }}
      state={{ ...workbench, event_revision: result.event_revision + 1 }}
    />,
  );
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByText(/请重新试排后比较/)).toBeTruthy();
  rerender(
    <PlannerInsertionComparison
      record={{ ...request, assessment: result, assessment_stale: true }}
      state={workbench}
    />,
  );
  expect(screen.queryByRole('img')).toBeNull();
});

it('labels published comparisons as historical without suggesting an unavailable retry', () => {
  render(
    <PlannerInsertionComparison
      record={{ ...request, status: 'published', assessment: result }}
      state={{ ...workbench, baseline: { ...workbench.baseline, fingerprint: 'published-plan' } }}
    />,
  );
  expect(screen.getByText(/该申请已发布，试排结果作为历史记录保留/)).toBeTruthy();
  expect(screen.queryByText(/请重新试排后比较/)).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
});

beforeEach(() => {
  history.replaceState(null, '');
  sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/sales/requests/URG-TEST-1') {
        const response = await vi.mocked(fetch)('/api/sales/requests');
        return new Response(JSON.stringify((await response.json())[0]));
      }
      if (
        url === '/api/sales/requests' ||
        url === '/api/sales/requests?assigned_planner=planner_01'
      )
        return new Response(
          JSON.stringify([
            {
              ...request,
              assessment: {
                ...result,
                workflow: {
                  mode: 'rules',
                  trace: ['validation', 'scheduling', 'evaluation', 'explanation'].map((agent) => ({
                    agent,
                    status: 'success',
                    mode: 'rules',
                  })),
                  explanation: { facts: [], risks: [], limitations: [], next_steps: [] },
                },
              },
            },
            { ...request, id: 'other', request_no: 'URG-OTHER', status: 'published' },
          ]),
        );
      if (url === '/api/workflow')
        return new Response(
          JSON.stringify({
            workflow: {
              id: 'w1',
              status: 'completed',
              results: {},
              trace: [],
              evidence_catalog: {},
            },
            simulation: null,
          }),
        );
      if (url === '/api/event') {
        const body = JSON.parse(String(options?.body));
        return new Response(
          JSON.stringify({
            ...workbench,
            event_revision: 2,
            event: {
              ...workbench.event,
              machine_id: body.machine_id,
              recovered_at: body.recovered_at,
              source: body.source,
            },
          }),
        );
      }
      return new Response(JSON.stringify(workbench));
    }),
  );
});

it('returns through planner pages before role selection and preserves explicit role switching', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /进入排产工作台/ }));
  await screen.findByRole('heading', { name: '当前执行计划' });
  await analyzeFault();
  act(() => history.back());
  await screen.findByRole('heading', { name: '排产计划工作台' });
  expect(screen.queryByRole('heading', { name: '选择你的工作角色' })).toBeNull();
  act(() => history.back());
  await screen.findByRole('heading', { name: '选择你的工作角色' });
  act(() => history.forward());
  await screen.findByRole('heading', { name: '当前执行计划' });
  await analyzeFault();
  fireEvent.click(screen.getByRole('button', { name: '选择角色' }));
  await screen.findByRole('heading', { name: '选择你的工作角色' });
  fireEvent.click(screen.getByRole('button', { name: /进入排产工作台/ }));
  await screen.findByRole('heading', { name: '排产计划工作台' });
});

it('shows the decision breadcrumb and navigates to either parent level', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /进入排产工作台/ }));
  await screen.findByRole('heading', { name: '排产计划工作台' });
  await analyzeFault();
  const path = screen.getByRole('navigation', { name: '当前位置' });
  expect(within(path).getByText('故障影响与方案决策').getAttribute('aria-current')).toBe('page');
  fireEvent.click(within(path).getByRole('button', { name: '工作台总览' }));
  await screen.findByRole('heading', { name: '排产计划工作台' });
  expect(location.hash).toBe('#/planner');
  await analyzeFault();
  fireEvent.click(
    within(screen.getByRole('navigation', { name: '当前位置' })).getByRole('button', {
      name: '选择角色',
    }),
  );
  await screen.findByRole('heading', { name: '选择你的工作角色' });
  expect(location.hash).toBe('#/roles');
});

it.each([null, { 'sched-copilot.demo-navigation.v1': null }])(
  'repairs an older dashboard history entry before opening a child: %s',
  async (legacyState) => {
    sessionStorage.setItem('sched-copilot.demo-role.v1', 'planner');
    const page = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByRole('heading', { name: '排产计划工作台' });
    // Simulate an older tab or history entry that lost its role metadata.
    history.replaceState(legacyState, '', '/');
    await analyzeFault();
    expect(location.hash).toBe('#/planner/fault-decision');
    act(() => history.back());
    await screen.findByRole('heading', { name: '排产计划工作台' });
    expect(location.hash).toBe('#/planner');
    expect(screen.queryByRole('heading', { name: '选择你的工作角色' })).toBeNull();
    act(() => history.forward());
    await screen.findByRole('heading', { name: '故障影响与方案决策', level: 1 });
    page.unmount();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByRole('heading', { name: '故障影响与方案决策', level: 1 });
    act(() => history.back());
    await screen.findByRole('heading', { name: '排产计划工作台' });
  },
);

it('opens with submitted request history and formal plan, and keeps fault editing hidden', async () => {
  render(<WorkbenchPage />);
  await screen.findByRole('heading', { name: '插单申请审批' });
  await screen.findByText('URG-TEST-1');
  expect(screen.getByText('URG-OTHER')).toBeTruthy();
  expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
    '申请编号',
    '产品',
    '数量',
    '状态',
    '申请业务员',
    '要求交期',
    '提交时间',
  ]);
  expect(screen.queryByLabelText('故障设备')).toBeNull();
  expect(screen.getByRole('button', { name: '开始 AI 分析并生成方案' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '故障影响与方案决策' })).toBeNull();
  expect(screen.getAllByRole('img', { name: '设备工序甘特图' })).toHaveLength(1);
  expect(screen.getByText('分析窗口：10/19 13:00 — 10/19 17:00')).toBeTruthy();
  const faultCard = screen.getByRole('region', { name: '已登记设备故障' });
  expect(within(faultCard).getByText('当前计划有 1 道工序受故障影响。').tagName).toBe('STRONG');
  expect(within(faultCard).queryByText(/来源：/)).toBeNull();
  expect(within(faultCard).queryByLabelText('事件分析标识')).toBeNull();
  const list = screen.getByRole('heading', { name: '插单申请审批' });
  const plan = screen.getByRole('heading', { name: '当前执行计划' });
  expect(list.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(plan.closest('.dashboard-plan')).toBeTruthy();
  expect(list.closest('.dashboard-summary')).toBeTruthy();
  expect(
    screen.getByRole('heading', { name: '异常与预警' }).closest('.dashboard-summary'),
  ).toBeTruthy();
  expect(screen.queryByText(/针对 \[.*\] 的分析链路/)).toBeNull();
  expect(screen.queryByRole('region', { name: '四个智能环节执行状态' })).toBeNull();
  expect(plan.closest('main')?.lastElementChild?.contains(plan)).toBe(true);
});

it('shows the saved analysis time and Trace for the same fault revision as the chain title', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, options) =>
    url === '/api/workflow/latest'
      ? Promise.resolve(
          new Response(
            JSON.stringify({
              workflow: {
                id: 'saved-workflow',
                trace_id: 'TRC-SAVED-FAULT',
                created_at: '2026-10-19T06:30:00Z',
                intent: 'generate_candidates',
                status: 'completed',
                trace: [],
                results: {},
                evidence_catalog: {},
              },
              simulation,
            }),
          ),
        )
      : original(url, options),
  );
  render(<WorkbenchPage />);
  await screen.findByRole('button', { name: '查看 AI 分析详情' });
  const fault = screen.getByRole('region', { name: '已登记设备故障' });
  expect(within(fault).queryByText('TRC-SAVED-FAULT')).toBeNull();
  expect(within(fault).getByLabelText('AI 分析方案：已完成')).toBeTruthy();
  expect(within(fault).getByLabelText('管理者审批：待提交')).toBeTruthy();
  expect(
    screen.getByRole('heading', { name: '排产计划工作台' }).closest('header')?.textContent,
  ).not.toContain('当前步骤');
  expect(screen.queryByRole('heading', { name: '本次智能分析链路' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看 AI 分析详情' }));
  expect(screen.getByRole('heading', { name: '故障影响与方案决策', level: 1 })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText('分析于 10/19 14:30')).toBeTruthy();
  expect(screen.getAllByText('TRC-SAVED-FAULT').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '采纳 AI 等待方案' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '采纳 AI 转移方案' })).toBeTruthy();
  expect(location.hash).toBe('#/planner/fault-decision');
  expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/workflow')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '← 工作台总览' }));
  await screen.findByRole('heading', { name: '排产计划工作台' });
  expect(location.hash).toBe('#/planner');
});

it('sorts both task lists newest first and filters each card independently without refetching or hiding the plan', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, options) => {
    if (url === '/api/workbench')
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ...workbench,
            event_history: [
              {
                ...workbench.event,
                revision: 2,
                machine_id: 'M2',
                started_at: '2026-10-20T00:00:00+08:00',
              },
              {
                ...workbench.event,
                revision: 3,
                machine_id: 'M3',
                started_at: '2026-10-18T23:00:00+08:00',
              },
            ],
          }),
        ),
      );
    if (url === '/api/sales/requests?assigned_planner=planner_01')
      return Promise.resolve(
        new Response(
          JSON.stringify([
            {
              ...request,
              id: 'old',
              request_no: 'URG-OLD',
              created_at: '2026-10-18T13:00:00+08:00',
            },
            {
              ...request,
              id: 'edge',
              request_no: 'URG-END-DAY',
              created_at: '2026-10-19T15:59:59Z',
            },
            { ...request, id: 'new', request_no: 'URG-NEW', created_at: '2026-10-19T16:00:00Z' },
          ]),
        ),
      );
    return original(url, options);
  });
  render(<WorkbenchPage />);
  await screen.findByText('URG-NEW');
  expect(
    screen.getAllByRole('button', { name: /^URG-/ }).map((button) => button.textContent),
  ).toEqual(['URG-NEW', 'URG-END-DAY', 'URG-OLD']);
  const alerts = screen.getByRole('region', { name: '异常与预警' });
  expect(
    within(alerts)
      .getAllByRole('heading')
      .slice(1)
      .map((heading) => heading.textContent),
  ).toEqual(['M2 停机 · M2 · 编号缺失', '⚠️ 已登记设备故障：M1 停机', 'M3 停机 · M3 · 编号缺失']);
  const callsBefore = vi.mocked(fetch).mock.calls.length;
  const requests = screen.getByRole('region', { name: '插单申请与状态跟踪' });
  function chooseDay(card: HTMLElement) {
    fireEvent.click(within(card).getByRole('button', { name: '选择时间范围' }));
    const calendar = screen.getByRole('dialog', { name: '选择日期范围' });
    fireEvent.change(within(calendar).getByLabelText('显示月份'), { target: { value: '2026-10' } });
    fireEvent.click(within(calendar).getByRole('button', { name: '2026-10-19' }));
    fireEvent.click(within(calendar).getByRole('button', { name: '2026-10-19' }));
  }
  chooseDay(requests);
  expect(
    screen.getAllByRole('button', { name: /^URG-/ }).map((button) => button.textContent),
  ).toEqual(['URG-END-DAY']);
  expect(within(alerts).getByText('M2 停机 · M2 · 编号缺失')).toBeTruthy();
  chooseDay(alerts);
  expect(within(alerts).queryByText('M2 停机 · M2 · 编号缺失')).toBeNull();
  expect(within(alerts).queryByText('M3 停机 · M3 · 编号缺失')).toBeNull();
  expect(within(alerts).getByRole('region', { name: '已登记设备故障' })).toBeTruthy();
  expect(screen.getByRole('img', { name: '设备工序甘特图' })).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('opens a selected request in full-screen details with its own trace and plan comparison', async () => {
  render(<WorkbenchPage />);
  await screen.findByText('URG-TEST-1');
  fireEvent.click(screen.getByRole('button', { name: 'URG-TEST-1' }));
  const dialog = await screen.findByRole('dialog', { name: '插单影响与方案决策' });
  await within(dialog).findByText('M2 / MD-URG-A');
  expect(within(dialog).queryByText('URG-OTHER')).toBeNull();
  expect(dialog.classList.contains('console-drawer')).toBe(true);
  expect(
    vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/sales/requests/URG-TEST-1'),
  ).toBe(true);
  expect(location.hash).toContain('/requests/URG-TEST-1');
  expect(document.body.style.overflow).toBe('hidden');
  expect(within(dialog).getByRole('region', { name: '试排影响明细', hidden: true })).toBeTruthy();
  expect(within(dialog).getByRole('region', { name: '插单方案比较' })).toBeTruthy();
  expect(within(dialog).getAllByRole('img')).toHaveLength(2);
  expect(within(dialog).getByText('URG-TEST-1-OP1 · 第1道')).toBeTruthy();
  const chart = within(dialog).getAllByRole('img')[1];
  expect(chart.textContent).toContain('URG-TEST-1-OP1');
  expect(chart.textContent).not.toContain('URG-request-1');
  const bar = within(chart).getByRole('graphics-symbol', { name: /URG-TEST-1-OP1/ });
  fireEvent.focus(bar);
  fireEvent.click(bar);
  const selectedRow = within(dialog).getByText('URG-TEST-1-OP1 · 第1道').closest('tr');
  expect(selectedRow?.getAttribute('aria-selected')).toBe('true');
  expect(selectedRow?.classList.contains('operation-row-selected')).toBe(true);
  expect(selectedRow?.closest('details')?.open).toBe(true);
  expect(bar.getAttribute('aria-label')).not.toContain('request-1');
  expect(within(dialog).queryByText('URG-request-1-OP1')).toBeNull();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/workflow')).toBe(false);
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('heading', { name: '排产计划工作台' })).toBeTruthy();
});

it('saves fault edits in the dialog, closes it without changing the published fault shadow', async () => {
  render(<WorkbenchPage />);
  await screen.findByRole('heading', { name: '当前执行计划' });
  fireEvent.click(screen.getByRole('button', { name: '+ 录入设备故障' }));
  const dialog = screen.getByRole('dialog', { name: '录入设备故障' });
  fireEvent.change(within(dialog).getByLabelText('故障设备'), { target: { value: 'M2' } });
  fireEvent.change(within(dialog).getByLabelText('事件来源'), { target: { value: '新设备故障' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '保存故障事件' }));
  await screen.findByText('故障事件已保存。请重新生成候选方案，执行计划未改变。');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('button', { name: '查看执行计划 V1 发布信息' })).toBeTruthy();
  expect(within(screen.getByRole('img')).queryByRole('group', { name: 'M2 停机留痕' })).toBeNull();
  expect(screen.getByRole('heading', { name: '排产计划工作台' })).toBeTruthy();
  expect(location.hash).toBe('#/planner');
  const banner = screen.getByRole('region', { name: '已登记设备故障' });
  expect(banner.textContent).toContain('M2 停机');
  expect(banner.textContent).toContain('10/19 13:00');
  expect(banner.textContent).toContain('10/19 17:00');
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/workflow')).toHaveLength(0);
  await analyzeFault();
  const workflowCalls = vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/workflow');
  expect(workflowCalls).toHaveLength(1);
  expect(JSON.parse(String(workflowCalls[0][1]?.body))).toMatchObject({
    intent: 'generate_candidates',
    event_revision: 2,
    baseline_fingerprint: 'plan-1',
  });
});

it('keeps failed saves editable and allows canceling a draft without an API write', async () => {
  render(<WorkbenchPage />);
  await screen.findByRole('heading', { name: '当前执行计划' });
  fireEvent.click(screen.getByRole('button', { name: '+ 录入设备故障' }));
  fireEvent.change(screen.getByLabelText('事件来源'), { target: { value: '草稿' } });
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ detail: '保存失败' }), { status: 500 }),
  );
  fireEvent.click(screen.getByRole('button', { name: '保存故障事件' }));
  const error = await screen.findByRole('alert');
  expect(error.textContent).toBe('保存失败');
  expect(screen.getByRole('dialog')).toBeTruthy();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '+ 录入设备故障' }));
  expect((screen.getByLabelText('事件来源') as HTMLInputElement).value).toBe(
    workbench.event.source,
  );
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/event')).toHaveLength(1);
});

it('uses browser Back and Forward for fault pages and nested dialogs', async () => {
  render(<WorkbenchPage />);
  await screen.findByRole('heading', { name: '当前执行计划' });
  await analyzeFault();
  expect(screen.queryByRole('button', { name: '+ 录入设备故障' })).toBeNull();
  expect(screen.getByLabelText('甘特图缩放')).toBeTruthy();
  expect(screen.getByLabelText('甘特图查看起点')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '← 工作台总览' }));
  await screen.findByRole('heading', { name: '排产计划工作台' });
  fireEvent.click(screen.getByRole('button', { name: '+ 录入设备故障' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  act(() => history.back());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('heading', { name: '排产计划工作台' })).toBeTruthy();
  act(() => history.forward());
  await screen.findByRole('dialog', { name: '录入设备故障' });
  expect(screen.getByRole('heading', { name: '排产计划工作台' })).toBeTruthy();
});

it('restores insertion details on Forward and remount after returning to the dashboard', async () => {
  const first = render(<WorkbenchPage />);
  await screen.findByText('URG-TEST-1');
  fireEvent.click(screen.getByRole('button', { name: 'URG-TEST-1' }));
  await screen.findByRole('dialog', { name: '插单影响与方案决策' });
  act(() => history.back());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('heading', { name: '排产计划工作台' })).toBeTruthy();
  act(() => history.forward());
  await screen.findByRole('dialog', { name: '插单影响与方案决策' });
  first.unmount();
  render(<WorkbenchPage />);
  const dialog = await screen.findByRole('dialog', { name: '插单影响与方案决策' });
  await within(dialog).findByText('M2 / MD-URG-A');
});

it('synchronizes baseline and trial operation clicks with the matching table row', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    const response = await originalFetch(url, options);
    if (url !== '/api/sales/requests/URG-TEST-1') return response;
    const record = await response.json();
    const original = workbench.baseline.operations[0];
    record.assessment.details.operations.push({
      ...result.details.operations[0],
      operation_id: original.id,
      order_id: original.order_id,
      machine_id: 'M2',
      start: original.start,
      end: original.end,
    });
    return new Response(JSON.stringify(record));
  });
  render(<WorkbenchPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'URG-TEST-1' }));
  const drawer = await screen.findByRole('dialog', { name: '插单影响与方案决策' });
  const tableLabel = await within(drawer).findByText('O1-OP1 · 第1道');
  const charts = within(drawer).getAllByRole('img');
  const baselineBar = within(charts[0]).getByRole('graphics-symbol', { name: /^O1-OP1 M1/ });
  const trialBar = within(charts[1]).getByRole('graphics-symbol', { name: /^O1-OP1 M2/ });
  fireEvent.click(trialBar);
  expect(tableLabel.closest('tr')?.getAttribute('aria-selected')).toBe('true');
  expect(tableLabel.closest('details')?.open).toBe(true);
  expect(baselineBar.parentElement?.dataset.selected).toBe('true');
  expect(trialBar.parentElement?.dataset.selected).toBe('true');
  const inserted = within(charts[1]).getByRole('graphics-symbol', { name: /URG-TEST-1-OP1/ });
  fireEvent.click(inserted);
  expect(tableLabel.closest('tr')?.getAttribute('aria-selected')).toBe('false');
  expect(baselineBar.parentElement?.dataset.selected).toBe('false');
  fireEvent.click(baselineBar);
  expect(tableLabel.closest('tr')?.getAttribute('aria-selected')).toBe('true');
  expect(trialBar.parentElement?.dataset.selected).toBe('true');
});

async function analyzeFault() {
  const unlock = screen.queryByRole('button', { name: '解锁' });
  if (unlock) {
    fireEvent.click(unlock);
    fireEvent.change(screen.getByLabelText('演示密码'), { target: { value: 'admin123' } });
    fireEvent.click(screen.getAllByRole('button', { name: '解锁' }).at(-1)!);
  }
  fireEvent.click(screen.getByRole('button', { name: '开始 AI 分析并生成方案' }));
  await screen.findByRole('heading', { name: '故障影响与方案决策', level: 1 });
  await waitFor(() => expect(screen.queryByText('正在生成方案…')).toBeNull());
}

it('starts one workflow only on explicit analysis and presents the returned candidates', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementation((url, options) =>
    url === '/api/workflow'
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : originalFetch(url, options),
  );
  render(<WorkbenchPage />);
  const analyze = await screen.findByRole('button', { name: '开始 AI 分析并生成方案' });
  expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/workflow')).toBe(false);
  fireEvent.click(analyze);
  fireEvent.click(analyze);
  expect(screen.getByRole('heading', { name: '故障影响与方案决策', level: 1 })).toBeTruthy();
  expect(screen.getByText('正在生成方案…')).toBeTruthy();
  expect((screen.getByRole('button', { name: /生成候选方案/ }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/workflow')).toHaveLength(1);
  await act(async () =>
    finish(
      new Response(
        JSON.stringify({
          workflow: { id: 'w1', status: 'completed', results: {}, trace: [], evidence_catalog: {} },
          simulation,
        }),
      ),
    ),
  );
  await screen.findByRole('heading', { name: '2　方案对比' });
  expect(screen.getByRole('heading', { name: '本次智能分析链路' })).toBeTruthy();
  expect(screen.getAllByRole('img')).toHaveLength(2);
  for (const title of ['4.4 工序调整对照', '4.5 订单交付对照']) {
    fireEvent.click(screen.getByRole('tab', { name: title }));
    const heading = screen.getByRole('heading', { name: title, level: 3 });
    expect(heading.closest('details')).toBeNull();
    expect(heading.parentElement?.querySelector('table')).toBeTruthy();
  }
  expect(screen.getByRole('heading', { name: '6　历史记录' }).closest('details')).toBeNull();
  expect(screen.getByRole('heading', { name: '4.11 执行详情' }).closest('details')?.open).toBe(
    false,
  );
  expect(screen.queryByLabelText('确认理由（必填）')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '采纳 AI 转移方案' }));
  expect(screen.getByRole('heading', { name: '人工确认' }).closest('details')).toBeNull();
  expect(screen.getByLabelText('确认理由（必填）')).toBeTruthy();
  expect((screen.getByLabelText('本次处理的方案') as HTMLSelectElement).value).toBe('transfer');
  expect((screen.getByLabelText('处理方式') as HTMLSelectElement).value).toBe('publish');
  expect(
    screen
      .getByRole('article', { name: 'AI 允许转移方案排产图' })
      .classList.contains('is-selected'),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '采纳 AI 等待方案' }));
  expect((screen.getByLabelText('本次处理的方案') as HTMLSelectElement).value).toBe('wait');
  expect(
    screen.getByRole('button', { name: '采纳 AI 等待方案' }).getAttribute('aria-pressed'),
  ).toBe('true');
  expect(
    screen.getByRole('button', { name: '采纳 AI 转移方案' }).getAttribute('aria-pressed'),
  ).toBe('false');
  expect(screen.getByRole('button', { name: '提交管理者审批' }).hasAttribute('disabled')).toBe(
    true,
  );
  expect(screen.queryByRole('button', { name: '确认发布执行计划' })).toBeNull();
  expect(
    screen.getByRole('button', { name: '不采纳，手动调整' }).closest('#fault-candidate'),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: '采纳方案' })).toBeNull();
  expect(screen.queryByRole('button', { name: '不采纳，人工调整' })).toBeNull();
  expect(screen.getByRole('heading', { name: '2　方案对比' }).closest('details')).toBeNull();
  const outline = screen.getByRole('navigation', { name: '本页大纲' });
  expect(
    within(outline)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual([
    '1 方案结论',
    '2 方案对比',
    '3 候选排产计划',
    '4 依据与风险',
    ...evidenceEntries.map(([, title]) => title),
    '5 人工确认',
    '6 历史记录',
  ]);
  const detailLink = within(outline).getByRole('link', { name: '4 依据与风险' });
  const detailHeading = document.getElementById('fault-evidence')!;
  const scroll = vi.fn();
  detailHeading.scrollIntoView = scroll;
  const routeBefore = window.location.href;
  fireEvent.click(detailLink);
  await waitFor(() => expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' }));
  expect(detailLink.getAttribute('aria-current')).toBe('location');
  expect(document.activeElement).toBe(detailHeading);
  expect(window.location.href).toBe(routeBefore);
});

it('blocks analysis of saved events with unknown recovery time', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, options) =>
    url === '/api/workbench'
      ? Promise.resolve(
          new Response(
            JSON.stringify({ ...workbench, event: { ...workbench.event, recovered_at: null } }),
          ),
        )
      : originalFetch(url, options),
  );
  render(<WorkbenchPage />);
  const analyze = await screen.findByRole('button', { name: '开始 AI 分析并生成方案' });
  expect((analyze as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('请补充预计恢复时间并保存后再分析。')).toBeTruthy();
  fireEvent.click(analyze);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/workflow')).toBe(false);
  expect(screen.getByRole('heading', { name: '排产计划工作台' })).toBeTruthy();
});

it.each([1000, 5000])(
  'keeps generation alive across navigation and reuses results (backend takes %i ms)',
  async (duration) => {
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    let finish!: (value: Response) => void;
    let signal: AbortSignal | null | undefined;
    vi.mocked(fetch).mockImplementation((url, options) => {
      if (url !== '/api/workflow') return originalFetch(url, options);
      signal = options?.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    render(<WorkbenchPage />);
    const analyze = await screen.findByRole('button', { name: '开始 AI 分析并生成方案' });
    vi.useFakeTimers();
    fireEvent.click(analyze);
    const back = screen.getByRole('button', { name: '← 工作台总览' }) as HTMLButtonElement;
    expect(back.disabled).toBe(false);
    expect(back.classList.contains('primary')).toBe(false);
    expect(
      (screen.getByRole('button', { name: 'AI 正在分析并生成候选方案' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(back);
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(screen.getByRole('heading', { name: '排产计划工作台' })).toBeTruthy();
    expect(screen.getByText('⏳ 方案生成中...')).toBeTruthy();
    expect(signal?.aborted).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '查看生成进度' }));
    expect(screen.getByRole('heading', { name: '故障影响与方案决策', level: 1 })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← 工作台总览' }));
    await act(() => vi.advanceTimersByTimeAsync(20));
    await act(() => vi.advanceTimersByTimeAsync(duration));
    expect(screen.queryByRole('button', { name: '查看 AI 分析详情' })).toBeNull();
    await act(async () =>
      finish(
        new Response(
          JSON.stringify({
            workflow: {
              id: 'w1',
              status: 'completed',
              results: {},
              trace: [],
              evidence_catalog: {},
            },
            simulation,
          }),
        ),
      ),
    );
    if (duration < 4000) {
      expect(screen.getByText('⏳ 方案生成中...')).toBeTruthy();
      await act(() => vi.advanceTimersByTimeAsync(4000 - duration));
    }
    fireEvent.click(screen.getByRole('button', { name: '查看 AI 分析详情' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(location.hash).toBe('#/planner/fault-decision');
    expect(screen.getByRole('heading', { name: '本次智能分析链路' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '2　方案对比' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '本次智能分析链路' })).toBeTruthy();
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(signal?.aborted).toBe(false);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/workflow')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '← 工作台总览' }));
    await act(() => vi.advanceTimersByTimeAsync(20));
    fireEvent.click(screen.getByRole('button', { name: '+ 录入设备故障' }));
    fireEvent.change(screen.getByLabelText('事件来源'), {
      target: { value: '新故障，旧结果失效' },
    });
    expect(screen.queryByRole('button', { name: '查看 AI 分析详情' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '保存故障事件' }));
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(screen.queryByRole('button', { name: '查看 AI 分析详情' })).toBeNull();
    expect(
      (screen.getByRole('button', { name: '开始 AI 分析并生成方案' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/workflow')).toHaveLength(1);
  },
);

it.each(['failed', 'blocked'])(
  'never announces a %s workflow as completed and allows retry',
  async (status) => {
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation((url, options) =>
      url === '/api/workflow'
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : originalFetch(url, options),
    );
    render(<WorkbenchPage />);
    const analyze = await screen.findByRole('button', { name: '开始 AI 分析并生成方案' });
    vi.useFakeTimers();
    fireEvent.click(analyze);
    fireEvent.click(screen.getByRole('button', { name: '← 工作台总览' }));
    await act(() => vi.advanceTimersByTimeAsync(20));
    await act(async () =>
      finish(
        new Response(
          JSON.stringify({
            workflow: { id: 'w1', status, results: {}, trace: [], evidence_catalog: {} },
            simulation: null,
          }),
        ),
      ),
    );
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(screen.queryByRole('button', { name: '查看 AI 分析详情' })).toBeNull();
    if (status === 'blocked') {
      fireEvent.click(screen.getByRole('button', { name: '查看AI评估详情' }));
      expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/workflow')).toHaveLength(
        1,
      );
      fireEvent.click(screen.getByRole('button', { name: '重新生成评估' }));
    } else {
      fireEvent.click(screen.getByRole('button', { name: '开始 AI 分析并生成方案' }));
    }
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/workflow')).toHaveLength(2);
    await act(async () =>
      finish(
        new Response(
          JSON.stringify({
            workflow: {
              id: 'w2',
              status: 'completed',
              results: {},
              trace: [],
              evidence_catalog: {},
            },
            simulation,
          }),
        ),
      ),
    );
    if (status === 'blocked') {
    }
    expect(screen.getByRole('heading', { name: '2　方案对比' })).toBeTruthy();
  },
);

it('requires confirmation to cancel a mistaken fault and removes it from active alerts', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (url === '/api/event/cancel')
      return new Response(
        JSON.stringify({
          ...workbench,
          event_cancelled: true,
          event_revision: workbench.event_revision + 1,
          affected: [],
          issues: [],
          event_history: [
            {
              ...workbench.event,
              revision: workbench.event_revision,
              created_at: workbench.event.received_at,
              cancelled: true,
            },
          ],
        }),
      );
    return originalFetch(url, options);
  });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<WorkbenchPage />);
  const button = await screen.findByRole('button', { name: '撤销' });
  fireEvent.click(button);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/event/cancel')).toBe(false);
  confirm.mockReturnValue(true);
  fireEvent.click(button);
  await screen.findByText(/故障及关联分析、候选和审批数据已永久删除/);
  expect(screen.queryByRole('region', { name: '已登记设备故障' })).toBeNull();
  expect(screen.getByText('所选时间范围内暂无故障预警。')).toBeTruthy();
  const request = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/event/cancel');
  expect(JSON.parse(String(request?.[1]?.body))).toEqual({
    event_revision: workbench.event_revision,
    baseline_fingerprint: workbench.baseline.fingerprint,
  });
  confirm.mockRestore();
});

it('shows conflict guidance without an impact conclusion for an invalid fault', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (url === '/api/workbench')
      return new Response(
        JSON.stringify({ ...workbench, issues: ['execution state conflicts with failure'] }),
      );
    return originalFetch(url, options);
  });
  render(<WorkbenchPage />);
  const fault = await screen.findByRole('region', { name: '已登记设备故障' });
  expect(within(fault).getByText('故障信息与执行记录不一致，暂不能分析')).toBeTruthy();
  expect(within(fault).queryByText('结论简要：')).toBeNull();
  expect(within(fault).getByRole('button', { name: '撤销' })).toBeTruthy();
  expect(
    within(fault).getByRole('button', { name: '开始 AI 分析并生成方案' }).hasAttribute('disabled'),
  ).toBe(true);
});

it.each([
  ['wait', '采纳 AI 等待方案'],
  ['transfer', '采纳 AI 转移方案'],
])(
  'submits the card-selected %s candidate for approval without publishing',
  async (candidateId, buttonLabel) => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((url, options) =>
      url === '/api/workflow'
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                workflow: {
                  id: 'card-workflow',
                  status: 'completed',
                  results: {},
                  trace: [],
                  evidence_catalog: {},
                },
                simulation,
              }),
            ),
          )
        : original(url, options),
    );
    render(<WorkbenchPage />);
    await screen.findByRole('button', { name: '开始 AI 分析并生成方案' });
    await analyzeFault();
    fireEvent.click(
      screen.getByRole('button', {
        name: candidateId === 'wait' ? '采纳 AI 转移方案' : '采纳 AI 等待方案',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: buttonLabel }));
    fireEvent.change(screen.getByLabelText('确认理由（必填）'), {
      target: { value: '已核实方案与延期风险，提交审批' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交管理者审批' }));
    await waitFor(() => {
      const reviewCalls = vi
        .mocked(fetch)
        .mock.calls.filter(([url]) => url === '/api/fault-reviews');
      expect(reviewCalls).toHaveLength(1);
      expect(JSON.parse(String(reviewCalls[0][1]?.body))).toMatchObject({
        simulation_id: simulation.id,
        candidate_id: candidateId,
        operator_role: 'planner',
      });
    });
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/decisions')).toBe(false);
  },
);
