import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DecisionPanel } from './DecisionPanel';
import { simulation, workbench } from '../../test/fixtures';
import type { FaultReview } from '../../shared/api/contracts';

const review: FaultReview = {
  id: 'review-1',
  simulation_id: simulation.id,
  candidate_id: 'transfer',
  baseline_fingerprint: workbench.baseline.fingerprint,
  event_revision: 1,
  status: 'approved',
  reason: '已核对现场',
  review_reason: '同意方案',
  created_at: workbench.snapshot_time,
  reviewed_at: workbench.snapshot_time,
  candidate_label: '转移方案',
  metrics: { total_lateness_minutes: 0, moved_operations: 1 },
};

function props() {
  return {
    state: workbench,
    currentSimulation: simulation,
    candidate: simulation.candidates[1],
    selected: 'transfer',
    busy: '',
    blocked: false,
    reason: '现场条件已确认',
    action: 'publish',
    onSelected: vi.fn(),
    onReason: vi.fn(),
    onAction: vi.fn(),
    onDecide: vi.fn(),
    onSubmitReview: vi.fn(),
  };
}

it('submits for management approval instead of publishing an unreviewed candidate', () => {
  const values = props();
  render(<DecisionPanel {...values} />);
  expect(screen.queryByRole('button', { name: '确认发布执行计划' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '提交管理者审批' }));
  expect(values.onSubmitReview).toHaveBeenCalledOnce();
  expect(values.onDecide).not.toHaveBeenCalled();
});

it('only publishes the exact approved candidate, and requires review after a change', () => {
  const values = props();
  const state = { ...workbench, fault_review: review };
  const view = render(<DecisionPanel {...values} state={state} />);
  fireEvent.click(screen.getByRole('button', { name: '确认发布执行计划' }));
  expect(values.onDecide).toHaveBeenCalledOnce();
  view.rerender(
    <DecisionPanel
      {...values}
      state={state}
      selected="wait"
      candidate={simulation.candidates[0]}
    />,
  );
  expect(screen.queryByRole('button', { name: '确认发布执行计划' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '修改后重新提交审批' }));
  expect(values.onSubmitReview).toHaveBeenCalledOnce();
});

it('holds pending requests until management has decided', () => {
  render(
    <DecisionPanel
      {...props()}
      state={{ ...workbench, fault_review: { ...review, status: 'pending' } }}
    />,
  );
  expect(
    (screen.getByRole('button', { name: '等待管理者审批' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.queryByRole('button', { name: '确认发布执行计划' })).toBeNull();
});
