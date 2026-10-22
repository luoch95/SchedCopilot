import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeaderPage } from './LeaderPage';
import { workbench } from '../../test/fixtures';

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
  await screen.findByText('暂无待审批工单');
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
  await screen.findByText('暂无待审批工单');
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
  const dialog = screen.getByRole('dialog', { name: 'M1故障 R1 · 智能分析明细' });
  expect(dialog.classList.contains('console-drawer')).toBe(true);
  expect(within(dialog).getAllByText('TRC-LEADER').length).toBeGreaterThan(0);
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
