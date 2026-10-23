import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FaultReviewPanel } from './FaultReviewPanel';
import { workbench } from '../../test/fixtures';
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
};

it('reviews actual assessment findings without inventing metrics or requesting publication', () => {
  render(
    <FaultReviewPanel
      state={{
        ...workbench,
        fault_review: {
          ...review,
          kind: 'assessment',
          workflow_id: 'analysis',
          metrics: null,
          status: 'approved',
          assessment: {
            outcome: 'no_feasible_candidate',
            summary: '当前策略未生成方案',
            findings: [{ text: 'M2 超出班次', evidence_refs: [] }],
            recommendations: ['补录班次'],
            limitations: ['审批通过不产生排产变更'],
          },
        },
      }}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByText('M2 超出班次')).toBeTruthy();
  expect(screen.getByText(/评估结论已批准/)).toBeTruthy();
  expect(screen.queryByText(/总延期|待排产员发布/)).toBeNull();
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
      vi.fn(async () => new Response(JSON.stringify(updated))),
    );
    const onChange = vi.fn();
    render(<FaultReviewPanel state={{ ...workbench, fault_review: review }} onChange={onChange} />);
    const button = screen.getByRole('button', {
      name: action === 'approve' ? '同意方案并交回排产员' : '退回修改',
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('审批意见（必填）'), {
      target: { value: '管理者意见' },
    });
    fireEvent.click(button);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(updated));
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('/api/fault-reviews/review-1/actions');
    expect(JSON.parse(String(options?.body))).toEqual({
      action,
      reason: '管理者意见',
      operator_role: 'leader',
    });
  },
);
