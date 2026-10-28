import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FaultReviewPanel } from './FaultReviewPanel';
import { workbench, simulation } from '../../test/fixtures';
import type { FaultReview } from '../../shared/api/contracts';

const review: FaultReview = {
  id: 'review-1',
  simulation_id: 'simulation-1',
  candidate_id: 'transfer',
  baseline_fingerprint: workbench.baseline.fingerprint,
  event_revision: 1,
  status: 'pending',
  reason: '现场已核对',
  review_reason: '',
  created_at: workbench.snapshot_time,
  reviewed_at: null,
  candidate_label: '转移方案',
  metrics: { total_lateness_minutes: 45, moved_operations: 2 },
  analysis: { event_revision: 1, baseline_version: 1, simulation, workflow: null },
};

it('loads a no-candidate assessment without inventing metrics or requesting publication', async () => {
  const detail: FaultReview = {
    ...review,
    analysis: null,
    kind: 'assessment',
    workflow_id: 'analysis',
    metrics: null,
    status: 'approved',
    workflow: {
      id: 'analysis',
      intent: 'generate_candidates',
      status: 'completed',
      failure_code: null,
      trace: [],
      results: {},
      evidence_catalog: {},
    },
    assessment: {
      outcome: 'no_feasible_candidate',
      summary: '当前策略未生成方案',
      findings: [{ text: 'M2 超出班次', evidence_refs: [] }],
      recommendations: ['补录班次'],
      limitations: ['审批通过不产生排产变更'],
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(detail))),
  );
  render(
    <FaultReviewPanel
      state={{
        ...workbench,
        fault_review: { ...detail, workflow: undefined, assessment: undefined },
      }}
      onChange={vi.fn()}
    />,
  );
  await screen.findByText('M2 超出班次');
  expect(screen.getByText(/评估结论已批准/)).toBeTruthy();
  expect(screen.queryByText(/总延期|待排产员发布/)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each(['approve', 'reject'] as const)(
  'records management %s and updates the shared snapshot',
  async (action) => {
    const updated = {
      ...workbench,
      fault_review: { ...review, status: action === 'approve' ? 'approved' : 'rejected' },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(JSON.stringify(url.endsWith('/actions') ? updated : review)),
      ),
    );
    const onChange = vi.fn();
    render(<FaultReviewPanel state={{ ...workbench, fault_review: review }} onChange={onChange} />);
    const button = screen.getByRole('button', {
      name: action === 'approve' ? '同意方案并交回排产员' : '退回修改',
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await screen.findByRole('region', { name: '候选方案比较' });
    fireEvent.change(screen.getByLabelText('审批意见（必填）'), {
      target: { value: '管理者意见' },
    });
    fireEvent.click(button);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(updated));
    const [url, options] = vi.mocked(fetch).mock.calls[1];
    expect(url).toBe('/api/fault-reviews/review-1/actions');
    expect(JSON.parse(String(options?.body))).toEqual({
      action,
      reason: '管理者意见',
      operator_role: 'leader',
    });
  },
);

it('loads the bound assessment from an overview before enabling approval', async () => {
  let resolve!: (value: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
  );
  render(
    <FaultReviewPanel
      state={{ ...workbench, fault_review: { ...review, analysis: undefined } }}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByRole('status').textContent).toContain('正在加载');
  fireEvent.change(screen.getByLabelText('审批意见（必填）'), { target: { value: '通过' } });
  expect(screen.getByRole('button', { name: '同意方案并交回排产员' })).toHaveProperty(
    'disabled',
    true,
  );
  resolve(new Response(JSON.stringify(review)));
  await screen.findByRole('region', { name: '候选方案比较' });
  expect(screen.getByRole('button', { name: '同意方案并交回排产员' })).toHaveProperty(
    'disabled',
    false,
  );
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/fault-reviews/review-1');
});

it('blocks approval on a detail error and supports retry', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: '读取失败' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(review))),
  );
  render(<FaultReviewPanel state={{ ...workbench, fault_review: review }} onChange={vi.fn()} />);
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: '同意方案并交回排产员' })).toHaveProperty(
    'disabled',
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: '重试加载详情' }));
  await screen.findByRole('region', { name: '候选方案比较' });
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each([
  { ...review, id: 'another-review' },
  { ...review, event_revision: 2 },
  { ...review, baseline_fingerprint: 'another-plan' },
  { ...review, status: 'approved' },
  { ...review, analysis: null },
])('rejects mismatched or incomplete detail %#', async (detail) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(detail))),
  );
  render(<FaultReviewPanel state={{ ...workbench, fault_review: review }} onChange={vi.fn()} />);
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: '同意方案并交回排产员' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(screen.queryByRole('region', { name: '候选方案比较' })).toBeNull();
});
