import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
};
const request: InsertionRequestRecord = {
  id: 'request-1',
  request_no: 'URG-TEST-1',
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
      if (options?.method === 'POST') {
        records = [{ ...request, assessment: result }];
        return new Response(JSON.stringify(result));
      }
      return new Response(JSON.stringify(records));
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
  first.unmount();
  render(<PendingRequestsPanel />);
  await screen.findByText('待审批 · 已试排');
  expect(screen.getByText('满足')).toBeTruthy();
});

it('planner sees the exact same saved summary plus equipment and operation details', async () => {
  records = [{ ...request, assessment: result }];
  render(<PendingRequestsPanel planner />);
  await screen.findByText('待审批 · 已试排');
  expect(screen.getByText('满足')).toBeTruthy();
  expect(screen.getByText('设备与工序排布明细')).toBeTruthy();
  expect(screen.getByText('M2 / MD-URG-A')).toBeTruthy();
  expect(screen.getByText('URG-request-1-OP1 · 第1道')).toBeTruthy();
});

it('shows stale results and permits reassessment, and keeps failures distinct from results', async () => {
  records = [{ ...request, assessment: result, assessment_stale: true }];
  render(<PendingRequestsPanel />);
  await screen.findByText('待审批 · 试排过期');
  expect(screen.getByText(/正式计划、事件或生产资源已变化/)).toBeTruthy();
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
