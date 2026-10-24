import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { workbench } from '../../test/fixtures';
import { LeaderPage } from './LeaderPage';
import { AssessmentView } from './AssessmentView';
import { PendingRequestsPanel } from './PendingRequestsPanel';
import type { InsertionAssessment, InsertionRequestRecord } from '../../shared/api/contracts';

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
  workflow: {
    mode: 'rules',
    trace: [],
    explanation: {
      facts: [],
      risks: [],
      limitations: [],
      next_steps: [],
      knowledge: {
        status: 'matched',
        mode: 'rules',
        message: '检索到相关模拟演示资料。',
        sources: [
          {
            chunk_id: 'K-URG-001@1.0#1',
            document_id: 'K-URG-001',
            title: '紧急插单审批规范',
            version: '1.0',
            section: '风险确认',
            excerpt: '模拟演示资料：原订单延期加重时需管理者确认。',
            filename: 'insertion-approval.md',
            kind: '模拟演示资料',
            content_sha256: 'hash',
          },
        ],
        items: [
          {
            source_id: 'K-URG-001@1.0#1',
            text: '建议依据审批规范复核。',
            fact_ids: ['B1'],
            related_facts: ['受影响原订单：1'],
          },
        ],
        execution: {
          calls: 0,
          model: null,
          error_code: null,
          input_tokens: null,
          output_tokens: null,
          elapsed_ms: 1,
          prompt_sha256: 'hash',
        },
      },
    },
  },
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
let records: InsertionRequestRecord[];
beforeEach(() => {
  records = [{ ...request }];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (_url === '/api/workbench') return new Response(JSON.stringify(workbench));
      if (options?.method === 'POST') {
        records = [{ ...request, assessment: result }];
        return new Response(JSON.stringify(result));
      }
      return new Response(
        JSON.stringify(String(_url).endsWith('/' + request.request_no) ? records[0] : records),
      );
    }),
  );
});

it('evaluates a saved request and renders macro data only for sales, restoring it after remount', async () => {
  const first = render(<PendingRequestsPanel />);
  await screen.findByText('URG-TEST-1');
  fireEvent.click(screen.getByText('查看需求'));
  fireEvent.click(screen.getByRole('button', { name: '评估插单' }));
  await screen.findByText('待审批 · 已试排');
  expect(screen.getByText('满足')).toBeTruthy();
  expect(screen.getByText('O1001 · 原订单')).toBeTruthy();
  expect(screen.queryByText(/M2|MD-URG-A|URG-request-1-OP1/)).toBeNull();
  expect(screen.queryByText('设备与工序排布明细')).toBeNull();
  expect(screen.getByLabelText('查看原文：紧急插单审批规范')).toBeTruthy();
  expect(screen.getByText(/紧急插单审批规范 · v1.0/)).toBeTruthy();
  first.unmount();
  render(<PendingRequestsPanel />);
  await screen.findByText('待审批 · 已试排');
  expect(screen.getByText('满足')).toBeTruthy();
  expect(screen.getByLabelText('查看原文：紧急插单审批规范')).toBeTruthy();
  expect(screen.getByText(/紧急插单审批规范 · v1.0/)).toBeTruthy();
});

it('planner sees the exact same saved summary plus equipment and operation details', async () => {
  records = [{ ...request, assessment: result }];
  render(<PendingRequestsPanel planner />);
  await screen.findByText('待审批 · 已试排');
  expect(screen.getByText('满足')).toBeTruthy();
  expect(screen.getByText('设备与工序排布明细')).toBeTruthy();
  expect(screen.getByText('M2 / MD-URG-A')).toBeTruthy();
  expect(screen.getByText('URG-TEST-1-OP1 · 第1道')).toBeTruthy();
});

it('shows stale results and permits reassessment, and keeps failures distinct from results', async () => {
  records = [{ ...request, assessment: result, assessment_stale: true }];
  render(<PendingRequestsPanel />);
  await screen.findByText('待审批 · 试排过期');
  expect(screen.getByText(/执行计划、事件或生产资源已变化/)).toBeTruthy();
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ detail: 'no available shift', code: 'rule_violation' }), {
      status: 409,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: '重新试排' }));
  await screen.findByText('no available shift');
  expect(screen.getByText('待审批 · 试排过期')).toBeTruthy();
});

it('leader approves the saved assessment with a reason and sees the persisted result on remount', async () => {
  records = [{ ...request, assessment: result }];
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (String(url).endsWith('/actions')) {
      const body = JSON.parse(String(options?.body));
      expect(body).toEqual({
        action: 'approve',
        reason: '接受延期影响',
        assessment_id: 'assessment-1',
        operator_role: 'leader',
      });
      records = [
        {
          ...request,
          assessment: result,
          status: 'approved',
          approval: { status: 'approved', reason: body.reason },
        },
      ];
      return new Response(JSON.stringify(records[0]));
    }
    return new Response(JSON.stringify(records));
  });
  const first = render(<PendingRequestsPanel leader />);
  await screen.findByText('待审批 · 已试排');
  fireEvent.click(screen.getByText('查看需求'));
  expect(screen.queryByRole('button', { name: '重新试排' })).toBeNull();
  expect(screen.queryByText('设备与工序排布明细')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '批准插单' }));
  await screen.findByText('请填写审批或复核理由。');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '接受延期影响' } });
  fireEvent.click(screen.getByRole('button', { name: '批准插单' }));
  await screen.findByText('已批准 · 待复核发布 · 已试排');
  expect(screen.getByText('审批意见：接受延期影响')).toBeTruthy();
  first.unmount();
  render(<PendingRequestsPanel />);
  await screen.findByText('已批准 · 待复核发布 · 已试排');
  expect(screen.queryByRole('button', { name: '复核并发布插单' })).toBeNull();
});

it('planner publishes only approved fresh results and reloads the formal plan', async () => {
  records = [{ ...request, status: 'approved', assessment: result }];
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (String(url).endsWith('/actions')) {
      const body = JSON.parse(String(options?.body));
      expect(body.action).toBe('publish');
      expect(body.operator_role).toBe('planner');
      records = [{ ...records[0], status: 'published' }];
      return new Response(JSON.stringify(records[0]));
    }
    return new Response(JSON.stringify(records));
  });
  const onPublished = vi.fn();
  render(<PendingRequestsPanel planner onPublished={onPublished} />);
  await screen.findByText('已批准 · 待复核发布 · 已试排');
  fireEvent.click(screen.getByText('查看需求'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '已复核设备与工序' } });
  fireEvent.click(screen.getByRole('button', { name: '复核并发布插单' }));
  await screen.findByText('已发布');
  await waitFor(() => expect(onPublished).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('button', { name: '复核并发布插单' })).toBeNull();
  expect(screen.queryByRole('button', { name: '重新试排' })).toBeNull();
});

it('stale approved result cannot be published from the planner interface', async () => {
  records = [{ ...request, status: 'approved', assessment: result, assessment_stale: true }];
  render(<PendingRequestsPanel planner />);
  await screen.findByText('已批准 · 待复核发布 · 试排过期');
  fireEvent.click(screen.getByText('查看需求'));
  expect(
    (screen.getByRole('button', { name: '复核并发布插单' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByRole('button', { name: '重新试排' })).toBeTruthy();
});

it('opens leader approval details in a drawer and restores background scrolling on close', async () => {
  records = [{ ...request, assessment: result }];
  render(<LeaderPage onSwitchRole={() => {}} />);
  await screen.findByText(request.request_no);
  expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
    '申请编号',
    '产品',
    '数量',
    '状态',
  ]);
  expect(screen.queryByRole('button', { name: '批准插单' })).toBeNull();
  fireEvent.click(screen.getByText(request.product_id));
  const drawer = await screen.findByRole('dialog', { name: '插单审批详情' });
  await within(drawer).findByRole('button', { name: '批准插单' });
  expect(within(drawer).getByRole('textbox')).toBeTruthy();
  expect(within(drawer).getByText('订单延期变化明细')).toBeTruthy();
  expect(drawer.classList.contains('console-drawer')).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.click(within(drawer).getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.body.style.overflow).not.toBe('hidden');
});

it.each([
  { delta: 0, original: 0, projected: 0, highlighted: false },
  { delta: 0, original: 30, projected: 30, highlighted: false },
  { delta: -15, original: 30, projected: 15, highlighted: false },
  { delta: 15, original: 0, projected: 15, highlighted: true },
])(
  'highlights only additional customer due lateness: $delta ($original to $projected)',
  ({ delta, original, projected, highlighted }) => {
    render(
      <AssessmentView
        result={{
          ...result,
          summary: {
            ...result.summary,
            order_impacts: [
              {
                ...result.summary.order_impacts[0],
                order_id: 'O1005',
                order_name: '完工时间调整订单',
                completion_changed: true,
                delay_delta_minutes: delta,
                original_lateness_minutes: original,
                projected_lateness_minutes: projected,
              },
            ],
          },
        }}
      />,
    );
    const row = screen.getByText('O1005 · 完工时间调整订单').closest('tr')!;
    expect(row.classList.contains('order-impact-changed')).toBe(highlighted);
    expect(!!within(row).queryByText('受影响')).toBe(highlighted);
    expect(screen.getByRole('columnheader', { name: '试排预计完工' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: '新增交期延误' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '交期延误计算说明' }).getAttribute('title')).toBe(
      '此处计算的是超出客户要求交期的时长，而非单纯的完工时间变化。',
    );
  },
);

it('uses shared business stage labels and management bullets based on the actual assessment', () => {
  render(
    <AssessmentView
      result={{
        ...result,
        workflow: {
          mode: 'rules',
          trace: ['validation', 'scheduling', 'evaluation', 'explanation'].map((agent) => ({
            agent,
            status: 'success',
            mode: 'rules',
          })),
          explanation: {
            facts: ['不直接展示的后端长句'],
            risks: [],
            limitations: [],
            next_steps: [],
          },
        },
      }}
    />,
  );
  expect(screen.getByText('试排影响明细')).toBeTruthy();
  for (const label of ['影响范围校验', '产能交期试算', '风险代价评估', '决策依据生成'])
    expect(screen.getByText(label)).toBeTruthy();
  expect(
    screen.queryByText(/validation|scheduling|success|规则模式|不直接展示的后端长句/),
  ).toBeNull();
  expect(screen.getByText('预计完工：2026-10-19 16:00')).toBeTruthy();
  expect(screen.getByText('影响范围：涉及 1 个原订单，其中 0 个交期延误加重。')).toBeTruthy();
  expect(screen.getByText('决策提醒：原订单未新增交期延误，仍需按流程审批与复核。')).toBeTruthy();
  expect(document.querySelectorAll('.trial-impact-points li')).toHaveLength(4);
  expect(document.querySelectorAll('.trial-step-success')).toHaveLength(4);
});

it.each(['live', 'fallback'])(
  'shows saved %s model assistance without exposing equipment to sales',
  (mode) => {
    render(
      <AssessmentView
        result={{
          ...result,
          workflow: {
            mode,
            trace: [
              {
                agent: 'evaluation',
                status: 'success',
                mode,
                execution: {
                  mode,
                  model: 'test-model',
                  calls: 1,
                  elapsed_ms: 100,
                  error_code: mode === 'fallback' ? 'MODEL_TIMEOUT' : null,
                  highlights:
                    mode === 'live'
                      ? [
                          {
                            text: '原订单未新增交期延误。',
                            evidence_refs: ['summary.order_impacts'],
                          },
                        ]
                      : [],
                },
              },
            ],
            explanation: { facts: [], risks: [], limitations: [], next_steps: [] },
          },
        }}
      />,
    );
    expect(screen.getByText(mode === 'live' ? '大模型辅助完成' : '已回退规则分析')).toBeTruthy();
    if (mode === 'live') expect(screen.getByText('原订单未新增交期延误。')).toBeTruthy();
    else expect(screen.getByText(/已保留规则试排结果/)).toBeTruthy();
    expect(screen.queryByText('设备与工序排布明细')).toBeNull();
    expect(screen.queryByText('M2')).toBeNull();
    expect(screen.queryByText('MD-URG-A')).toBeNull();
    expect(screen.queryByText('MODEL_TIMEOUT')).toBeNull();
  },
);

it('keeps sales details outside the table and loads the saved summary by request number', async () => {
  records = [
    {
      ...request,
      assessment: result,
      status_history: [
        {
          from_status: 'draft',
          to_status: 'pending_approval',
          operator_role: 'sales',
          comment: '已提交',
          created_at: request.created_at,
        },
      ],
    },
  ];
  const onSelection = vi.fn();
  render(<PendingRequestsPanel onSelection={onSelection} />);
  await screen.findByText('待审批 · 已试排');
  expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
    '申请编号',
    '产品 / 数量',
    '要求交期',
    '状态',
    '操作',
  ]);
  expect(screen.queryByText('申请需求')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
  const drawer = await screen.findByRole('dialog', { name: '插单申请详情' });
  expect(drawer.style.width).toBe('50vw');
  await within(drawer).findByText('状态历史');
  expect(within(drawer).getByText('申请需求').closest('table')).toBeNull();
  expect(document.body.style.overflow).toBe('hidden');
  vi.mocked(fetch).mockClear();
  fireEvent.click(within(drawer).getByRole('button', { name: '查看试排摘要' }));
  await within(drawer).findByText('O1001 · 原订单');
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/sales/requests/URG-TEST-1');
  expect(onSelection).toHaveBeenLastCalledWith(expect.objectContaining({ assessment: result }));
  expect(within(drawer).queryByText('设备与工序排布明细')).toBeNull();
  await waitFor(() =>
    expect(
      (within(drawer).getByRole('button', { name: '关闭' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(within(drawer).getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.body.style.overflow).not.toBe('hidden');
});

it('keeps the drawer open with an actionable error when a saved summary fetch fails', async () => {
  records = [{ ...request, assessment: result }];
  render(<PendingRequestsPanel onSelection={vi.fn()} />);
  await screen.findByText('待审批 · 已试排');
  fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
  const drawer = await screen.findByRole('dialog');
  await within(drawer).findByRole('button', { name: '查看试排摘要' });
  vi.mocked(fetch).mockRejectedValueOnce(new Error('摘要读取失败，请重试'));
  fireEvent.click(within(drawer).getByRole('button', { name: '查看试排摘要' }));
  await within(drawer).findByRole('alert');
  expect(within(drawer).getByRole('button', { name: '查看试排摘要' })).toBeTruthy();
  fireEvent.click(within(drawer).getByRole('button', { name: '查看试排摘要' }));
  await within(drawer).findByText('O1001 · 原订单');
});

it('filters planner requests by demo identity and displays the persisted assignee', async () => {
  render(<PendingRequestsPanel planner assignedPlanner="planner_01" requestId={undefined} />);
  await screen.findByText('URG-TEST-1');
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/sales/requests?assigned_planner=planner_01');
  fireEvent.click(screen.getByText('查看需求'));
  expect(screen.getByText('指派排产员：planner_01')).toBeTruthy();
});

it('displays the persisted assignee in leader request details without filtering the leader list', async () => {
  render(<PendingRequestsPanel leader requestId="URG-TEST-1" />);
  await screen.findByText('指派排产员：planner_01');
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/sales/requests/URG-TEST-1');
});

it('renders Chinese timeline actions, full local dates and comments for the complete lifecycle', async () => {
  records = [
    {
      ...request,
      status_history: [
        {
          from_status: 'draft',
          to_status: 'pending_approval',
          operator_role: 'sales',
          comment: '客户补货',
          created_at: '2026-10-20T01:44:00Z',
        },
        {
          from_status: 'pending_approval',
          to_status: 'approved',
          operator_role: 'leader',
          comment: '同意',
          created_at: '2026-10-20T02:00:00Z',
        },
        {
          from_status: 'approved',
          to_status: 'pending_approval',
          operator_role: 'system',
          comment: '重新试排',
          created_at: '2026-10-20T02:10:00Z',
        },
        {
          from_status: 'pending_approval',
          to_status: 'rejected',
          operator_role: 'leader',
          comment: '交期风险',
          created_at: '2026-10-20T02:20:00Z',
        },
        {
          from_status: 'approved',
          to_status: 'published',
          operator_role: 'planner',
          comment: '复核通过',
          created_at: '2026-10-20T03:00:00Z',
        },
      ],
    },
  ];
  render(<PendingRequestsPanel requestId="URG-TEST-1" />);
  const timeline = await screen.findByRole('list', { name: '申请流转时间轴', hidden: true });
  expect(within(timeline).getAllByRole('listitem', { hidden: true })).toHaveLength(5);
  expect(timeline.textContent).toContain(
    '2026/10/20 09:44 — 业务员 (Sales) 提交了申请，状态变更为【待审批】',
  );
  expect(timeline.textContent).toContain('管理者 (Leader) 批准了插单申请');
  expect(timeline.textContent).toContain('系统 发起了重新审批');
  expect(timeline.textContent).toContain('管理者 (Leader) 驳回了插单申请');
  expect(timeline.textContent).toContain('排产计划员 (Planner) 复核并发布了排产计划');
  expect(timeline.textContent).toContain('备注：客户补货');
  expect(timeline.textContent).not.toMatch(/draft|pending_approval|->|→/);
  expect(timeline.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-20T01:44:00Z');
});

it('renders operation status tags in Chinese and marks each resource conflict with a warning icon', async () => {
  const issues = [
    'O1002-OP1 换型早于快照',
    'O1002-OP2 换型或加工超出班次',
    'O1004-OP1 与设备停机冲突',
  ];
  records = [
    {
      ...request,
      assessment: {
        ...result,
        baseline_resource_issues: issues,
        details: {
          ...result.details,
          operations: ['completed', 'planned', 'in_progress', 'unrecognized_state'].map(
            (status, index) => ({
              ...result.details.operations[0],
              operation_id: `OP-${index}`,
              sequence: index + 1,
              status,
            }),
          ),
        },
      },
    },
  ];
  render(<PendingRequestsPanel planner requestId="URG-TEST-1" />);
  await screen.findByText('设备与工序排布明细');
  fireEvent.click(screen.getByText('设备与工序排布明细'));
  const table = screen.getByText('已完工').closest('table')!;
  expect(table.textContent).not.toMatch(/completed|planned|in_progress|unrecognized_state/);
  for (const [label, tone] of [
    ['已完工', 'neutral'],
    ['计划中', 'blue'],
    ['加工中', 'blue'],
    ['状态待确认', 'neutral'],
  ]) {
    const tag = within(table).getByText(label);
    expect(tag.classList.contains(`status-tag-${tone}`)).toBe(true);
    expect(tag.closest('td')?.classList.contains('status-column')).toBe(true);
  }
  expect(
    within(table).getByRole('columnheader', { name: '状态' }).classList.contains('status-column'),
  ).toBe(true);
  expect(screen.getAllByRole('img', { name: '冲突警告' })).toHaveLength(3);
  for (const issue of issues) {
    expect(
      screen.getByText(issue).closest('p')?.querySelector('[aria-label="冲突警告"]')?.textContent,
    ).toBe('⚠️');
  }
});

it('uses Chinese status tags across the sales request list and detail view', async () => {
  records = ['draft', 'pending_approval', 'approved', 'rejected', 'published'].map(
    (status, index) => ({
      ...request,
      id: `request-${index}`,
      request_no: `URG-TEST-${index + 1}`,
      status: status as InsertionRequestRecord['status'],
    }),
  );
  render(<PendingRequestsPanel onSelection={vi.fn()} />);
  await screen.findByText('草稿 · 未试排');
  const table = screen.getByRole('table');
  expect(table.textContent).not.toMatch(/draft|pending_approval|approved|rejected|published/);
  for (const label of [
    '草稿 · 未试排',
    '待审批 · 未试排',
    '已批准 · 待复核发布 · 未试排',
    '已驳回',
    '已发布',
  ]) {
    const tag = within(table).getByText(label);
    expect(tag.classList.contains('status-tag')).toBe(true);
    expect(tag.closest('td')?.classList.contains('status-column')).toBe(true);
  }
  fireEvent.click(within(table).getAllByRole('button', { name: '查看详情' })[0]);
  const drawer = await screen.findByRole('dialog', { name: '插单申请详情' });
  expect(await within(drawer).findByText('草稿')).toBeTruthy();
});
