import { beforeEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import WorkbenchPage from './WorkbenchPage';
import App from './App';
import { PlannerInsertionComparison } from '../features/sales';
import { workbench } from '../test/fixtures';
import type { InsertionAssessment, InsertionRequestRecord } from '../shared/api/contracts';

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
  fireEvent.click(screen.getByRole('button', { name: '故障影响与方案决策' }));
  act(() => history.back());
  await screen.findByRole('heading', { name: '排产计划工作台' });
  expect(screen.queryByRole('heading', { name: '选择你的工作角色' })).toBeNull();
  act(() => history.back());
  await screen.findByRole('heading', { name: '选择你的工作角色' });
  act(() => history.forward());
  await screen.findByRole('heading', { name: '当前执行计划' });
  fireEvent.click(screen.getByRole('button', { name: '故障影响与方案决策' }));
  fireEvent.click(screen.getByRole('button', { name: '切换角色' }));
  await screen.findByRole('heading', { name: '选择你的工作角色' });
  fireEvent.click(screen.getByRole('button', { name: /进入排产工作台/ }));
  await screen.findByRole('heading', { name: '排产计划工作台' });
});

it('shows the decision breadcrumb and navigates to either parent level', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /进入排产工作台/ }));
  await screen.findByRole('heading', { name: '排产计划工作台' });
  fireEvent.click(screen.getByRole('button', { name: '故障影响与方案决策' }));
  const path = screen.getByRole('navigation', { name: '当前位置' });
  expect(within(path).getByText('故障影响与方案决策').getAttribute('aria-current')).toBe('page');
  fireEvent.click(within(path).getByRole('button', { name: '工作台总览' }));
  await screen.findByRole('heading', { name: '排产计划工作台' });
  expect(location.hash).toBe('#/planner');
  fireEvent.click(screen.getByRole('button', { name: '故障影响与方案决策' }));
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
    fireEvent.click(screen.getByRole('button', { name: '故障影响与方案决策' }));
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

it('opens with only the actionable request list and formal plan, and keeps fault editing hidden', async () => {
  render(<WorkbenchPage />);
  await screen.findByRole('heading', { name: '待审批插单申请' });
  await screen.findByText('URG-TEST-1');
  expect(screen.queryByText('URG-OTHER')).toBeNull();
  expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
    '申请编号',
    '产品',
    '数量',
    '状态',
  ]);
  expect(screen.queryByLabelText('故障设备')).toBeNull();
  expect(screen.queryByRole('button', { name: /生成候选方案/ })).toBeNull();
  expect(screen.getAllByRole('img', { name: '设备工序甘特图' })).toHaveLength(1);
  const list = screen.getByRole('heading', { name: '待审批插单申请' });
  const plan = screen.getByRole('heading', { name: '当前执行计划' });
  expect(list.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

it('saves fault edits in the dialog, closes it on success and refreshes the fault shadow', async () => {
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
  expect(screen.getByText(/已保存故障 M2/)).toBeTruthy();
  expect(screen.getByRole('img').querySelector('rect[fill="#F6DAD5"]')).toBeTruthy();
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
  fireEvent.click(screen.getByRole('button', { name: '故障影响与方案决策' }));
  fireEvent.click(screen.getByRole('button', { name: '+ 录入设备故障' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  act(() => history.back());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('heading', { name: '故障影响与方案决策', level: 1 })).toBeTruthy();
  act(() => history.back());
  await screen.findByRole('heading', { name: '排产计划工作台' });
  act(() => history.forward());
  await screen.findByRole('heading', { name: '故障影响与方案决策', level: 1 });
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
