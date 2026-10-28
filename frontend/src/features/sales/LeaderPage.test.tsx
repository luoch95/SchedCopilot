import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeaderPage } from './LeaderPage';
import { workbench, simulation } from '../../test/fixtures';
import type { Workbench } from '../../shared/api/contracts';

const published = {
  ...workbench,
  baseline: { ...workbench.baseline, version: 2 },
  plan_publication: {
    version: 2,
    published_at: '2026-10-20T06:41:00Z',
    published_by: 'planner_01',
    version_summary: '发布插单申请 URG-20261020-001',
  },
};
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/workbench') return new Response(JSON.stringify(published));
      if (url === '/api/sales/requests') return new Response('[]');
      if (url === '/api/workflow/latest')
        return new Response(
          JSON.stringify({
            workflow: {
              id: 'leader-analysis',
              trace_id: 'TRC-LEADER',
              intent: 'generate_candidates',
              status: 'completed',
              trace: [],
              results: {},
              evidence_catalog: {},
            },
            simulation: null,
          }),
        );
      if (url === '/api/events/1/analysis')
        return new Response(
          JSON.stringify({
            event_revision: 1,
            workflow: {
              id: 'leader-analysis',
              trace_id: 'TRC-LEADER',
              intent: 'generate_candidates',
              status: 'completed',
              trace: [],
              results: {},
              evidence_catalog: {},
            },
            simulation,
          }),
        );
      throw new Error(`Unexpected endpoint: ${url}`);
    }),
  );
});

it('shows ticker, KPI cards, two task cards and a collapsed read-only plan in order', async () => {
  const switchRole = vi.fn();
  render(<LeaderPage onSwitchRole={switchRole} />);
  expect(
    screen.getByRole('heading', { name: '车间运营驾驶舱 Workshop Operations Cockpit' }),
  ).toBeTruthy();
  expect(screen.getByLabelText('当前视角').textContent).toContain('当前视角 · 生产总监');
  await screen.findByText('暂无插单申请。');
  const summary = await screen.findByText('展开查看底层排产执行计划（当前版本 V2）');
  const approvals = screen.getByRole('region', { name: '插单申请与状态跟踪' });
  const overview = screen.getByRole('region', { name: '生产车间概况' });
  const ticker = screen.getByRole('region', { name: '车间实时动态' });
  expect(ticker.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole('img', { name: '设备工序甘特图' })).toBeNull();
  expect(summary.closest('details')?.open).toBe(false);
  expect(approvals.classList.contains('pending-requests-empty')).toBe(true);
  expect(approvals.querySelector('table')).toBeNull();
  expect(
    overview.compareDocumentPosition(approvals) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    approvals.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(within(overview).getByText('静态演示数据')).toBeTruthy();
  expect(within(overview).getByText('到岗率 95%')).toBeTruthy();
  expect(within(overview).getByText('利用率 80%')).toBeTruthy();
  expect(overview.querySelectorAll('.workshop-metric')).toHaveLength(4);
  expect(screen.getByRole('region', { name: '异常与预警' })).toBeTruthy();
  expect(within(approvals).getByRole('button', { name: '选择时间范围' })).toBeTruthy();
  fireEvent.click(summary);
  const plan = await screen.findByRole('region', { name: '生产计划甘特图' });
  const version = within(plan).getByRole('button', { name: '查看执行计划 V2 发布信息' });
  expect(within(plan).getByRole('graphics-symbol', { name: /O1-OP1 M1/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /录入设备故障/ })).toBeNull();
  fireEvent.click(version);
  expect(screen.getByText('发布人：planner_01')).toBeTruthy();
  expect(screen.getByText('变更摘要：发布插单申请 URG-20261020-001')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '切换角色' }));
  expect(switchRole).toHaveBeenCalledOnce();
});

it('shows alert line details on hover and keyboard focus', async () => {
  const user = userEvent.setup();
  render(<LeaderPage onSwitchRole={() => {}} />);
  await screen.findByText('暂无插单申请。');
  const m2 = screen.getByRole('button', { name: 'M2产线' });
  await user.hover(m2);
  expect(screen.getByRole('tooltip').textContent).toContain('插单 URG-20261020-001 影响了 M2');
  await user.unhover(m2);
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.focus(screen.getByRole('button', { name: 'M3产线' }));
  expect(screen.getByRole('tooltip').textContent).toContain('M3 停机维修');
  fireEvent.keyDown(screen.getByRole('button', { name: 'M3产线' }), { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  await user.hover(screen.getByRole('button', { name: 'M5产线' }));
  expect(screen.getByRole('tooltip').textContent).toContain('ABS 原料待补充');
});

it('recovers a failed formal plan read and refreshes to the latest version', async () => {
  let version = 2;
  let failed = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/sales/requests') return new Response('[]');
      if (failed) throw new Error('offline');
      return new Response(
        JSON.stringify({ ...published, baseline: { ...published.baseline, version } }),
      );
    }),
  );
  render(<LeaderPage onSwitchRole={() => {}} />);
  await screen.findByText('执行计划读取失败，请重试。');
  failed = false;
  fireEvent.click(screen.getAllByRole('button', { name: '同步最新计划' })[0]);
  fireEvent.click(await screen.findByText('展开查看底层排产执行计划（当前版本 V2）'));
  await screen.findByRole('button', { name: '查看执行计划 V2 发布信息' });
  version = 3;
  fireEvent.click(screen.getAllByRole('button', { name: '同步最新计划' })[0]);
  await screen.findByRole('button', { name: '查看执行计划 V3 发布信息' });
});

it('opens the same fault analysis in a read-only drawer without navigating or writing', async () => {
  render(<LeaderPage onSwitchRole={() => {}} />);
  const trigger = await screen.findByRole('button', { name: '查看 AI 分析详情' });
  await screen.findByRole('list', { name: '故障处理流程' });
  const hash = location.hash;
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'M1 · 编号缺失 · 智能分析明细' });
  expect(dialog.classList.contains('console-drawer')).toBe(true);
  expect((await within(dialog).findAllByText('TRC-LEADER')).length).toBeGreaterThan(0);
  for (const label of ['数据校验', '排产执行', '方案评估', '结果解释'])
    expect(within(dialog).getByText(label)).toBeTruthy();
  expect(location.hash).toBe(hash);
  expect(screen.queryByRole('button', { name: /录入.*故障|生成候选|确认发布/ })).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.every(([, options]) => !options?.method || options.method === 'GET'),
  ).toBe(true);
});

function serveAlerts(value: Workbench) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/workbench') return new Response(JSON.stringify(value));
      if (url === '/api/sales/requests') return new Response('[]');
      if (url === '/api/workflow/latest' || url === '/api/events/2/analysis')
        return new Response('null');
      if (url === '/api/fault-reviews/review-1')
        return new Response(JSON.stringify(value.fault_review));
      if (url === '/api/fault-reviews/review-1/actions') {
        expect(JSON.parse(options!.body as string)).toEqual({
          action: 'approve',
          reason: '核验通过',
          operator_role: 'leader',
        });
        return new Response(
          JSON.stringify({ ...value, fault_review: { ...value.fault_review, status: 'approved' } }),
        );
      }
      throw new Error(`Unexpected endpoint: ${url}`);
    }),
  );
}

it('uses the published card and its archived candidate metrics without an inline report', async () => {
  serveAlerts({
    ...published,
    event: { ...published.event, fault_business_code: 'M1-GZ01', fault_process_stage: '001' },
    plan_publication: {
      ...published.plan_publication,
      fault_analysis: {
        event_revision: 1,
        baseline_version: 1,
        published_version: 2,
        workflow: null,
        simulation,
        selected_candidate_id: 'wait',
      },
    },
  });
  render(<LeaderPage onSwitchRole={() => {}} />);
  const title = await screen.findByRole('heading', { name: /M1 停机 · M1-GZ01-004 · 已发布 V2/ });
  const card = title.closest('article')!;
  expect(card.classList.contains('is-published')).toBe(true);
  expect(within(card).getByText('已发布方案的预计结果：')).toBeTruthy();
  expect(card.textContent).toContain('预计 1 个订单延期，共 120 分钟');
  expect(within(card).queryByRole('region', { name: '故障方案审批' })).toBeNull();
  expect(within(card).queryByText(/剩余.*道工序受故障影响/)).toBeNull();
});

it('keeps approval forms in a drawer and still sends the leader approval action', async () => {
  serveAlerts({
    ...workbench,
    fault_review: {
      id: 'review-1',
      simulation_id: simulation.id,
      candidate_id: 'wait',
      baseline_fingerprint: 'plan-1',
      event_revision: 1,
      status: 'pending',
      reason: '调整排产',
      review_reason: '',
      created_at: workbench.snapshot_time,
      reviewed_at: null,
      candidate_label: '原 AI 方案',
      metrics: simulation.candidates[0].metrics,
      analysis: { event_revision: 1, baseline_version: 1, workflow: null, simulation },
    },
  });
  render(<LeaderPage onSwitchRole={() => {}} />);
  const trigger = await screen.findByRole('button', { name: '审批详情' });
  expect(screen.queryByRole('textbox', { name: '审批意见（必填）' })).toBeNull();
  expect(screen.getByRole('region', { name: '异常与预警' }).textContent).toContain(
    '预计 1 个订单延期，共 120 分钟',
  );
  fireEvent.click(trigger);
  const drawer = screen.getByRole('dialog', { name: '故障方案审批详情' });
  await within(drawer).findByRole('region', { name: '候选方案比较' });
  fireEvent.change(within(drawer).getByRole('textbox', { name: '审批意见（必填）' }), {
    target: { value: '核验通过' },
  });
  fireEvent.click(within(drawer).getByRole('button', { name: '同意方案并交回排产员' }));
  await within(drawer).findByText('故障方案审批 · 已批准，待排产员发布');
  expect(screen.queryByRole('button', { name: /确认发布/ })).toBeNull();
});

it('lists published history, filters duplicate outage revisions and isolates missing archives', async () => {
  const other = { ...workbench.event, machine_id: 'M2', started_at: '2026-10-18T13:00:00+08:00' };
  serveAlerts({
    ...workbench,
    event_revision: 3,
    event_history: [
      {
        ...workbench.event,
        revision: 1,
        created_at: workbench.snapshot_time,
        event_status: 'registered',
      },
      { ...other, revision: 2, created_at: other.started_at, event_status: 'published' },
    ],
    plan_publication: {
      ...published.plan_publication,
      version: 1,
      fault_traces: [{ version: 1, event_revision: 2, failure: other, affected_operations: [] }],
    },
  });
  render(<LeaderPage onSwitchRole={() => {}} />);
  const history = await screen.findByRole('article', { name: '历史故障 M2 · 编号缺失' });
  expect(screen.queryByRole('article', { name: '历史故障 M1 · 编号缺失' })).toBeNull();
  expect(history.textContent).toContain('历史指标记录缺失');
  fireEvent.click(within(history).getByRole('button', { name: '查看历史 AI 分析' }));
  const drawer = screen.getByRole('dialog', { name: 'M2 · 编号缺失 · 历史智能分析明细' });
  await within(drawer).findByText('该历史修订尚未生成 AI 分析，暂无分析记录。');
  expect(within(drawer).queryByText('TRC-LEADER')).toBeNull();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.every(([, options]) => !options?.method || options.method === 'GET'),
  ).toBe(true);
});
