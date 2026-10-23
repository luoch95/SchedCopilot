import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FaultProgress } from './FaultProgress';
import { simulation, workbench } from '../../test/fixtures';
import type { FaultReview, WorkflowResult } from '../../shared/api/contracts';

const workflow: WorkflowResult = {
  id: 'analysis',
  intent: 'generate_candidates',
  status: 'completed',
  failure_code: null,
  trace: [],
  results: {},
  evidence_catalog: {},
};
const review: FaultReview = {
  id: 'review',
  simulation_id: simulation.id,
  candidate_id: simulation.candidates[1].id,
  event_revision: workbench.event_revision,
  baseline_fingerprint: workbench.baseline.fingerprint,
  status: 'approved',
  reason: '现场确认',
  review_reason: '批准',
  candidate_label: '转机方案',
  metrics: { moved_operations: 1, total_lateness_minutes: 45 },
  created_at: workbench.snapshot_time,
  reviewed_at: workbench.snapshot_time,
};

it('advances a conclusion assessment through approval without requiring a plan publication', () => {
  const assessed: WorkflowResult = {
    ...workflow,
    results: {
      evaluation: {
        status: 'warning',
        warnings: [],
        errors: [],
        data: {
          assessment: {
            outcome: 'no_feasible_candidate',
            summary: '当前策略未生成方案',
            findings: [],
            recommendations: [],
            limitations: [],
          },
        },
      },
    },
  };
  const state = {
    ...workbench,
    fault_review: {
      ...review,
      kind: 'assessment' as const,
      workflow_id: workflow.id,
      metrics: null,
    },
  };
  const view = render(<FaultProgress state={state} workflow={assessed} />);
  expect(screen.getByLabelText('AI 分析方案：已完成').className).toBe('is-complete');
  expect(screen.getByLabelText('管理者审批：已批准').className).toBe('is-complete');
  expect(screen.getByLabelText('计划发布：评估结论无需发布排产').className).toBe('is-complete');
  view.rerender(<FaultProgress state={state} workflow={{ ...assessed, id: 'regenerated' }} />);
  expect(screen.getByLabelText('管理者审批：待提交').className).toBe('');
});

it('shows saved, analyzing and analyzed states without marking unfinished steps complete', () => {
  const view = render(<FaultProgress state={workbench} workflow={null} />);
  expect(screen.getByLabelText('故障登记：已保存').className).toBe('is-complete');
  expect(screen.getByLabelText('AI 分析方案：待分析').getAttribute('aria-current')).toBe('step');
  view.rerender(<FaultProgress state={workbench} workflow={null} generating />);
  expect(screen.getByLabelText('AI 分析方案：分析中').className).toBe('');
  view.rerender(<FaultProgress state={workbench} workflow={workflow} simulation={simulation} />);
  expect(screen.getByLabelText('AI 分析方案：已完成').className).toBe('is-complete');
  expect(screen.getByLabelText('管理者审批：待提交').getAttribute('aria-current')).toBe('step');
});

it.each(['pending', 'approved', 'rejected'] as const)('reflects the actual %s review', (status) => {
  render(
    <FaultProgress
      state={{ ...workbench, fault_review: { ...review, status } }}
      workflow={workflow}
      simulation={simulation}
    />,
  );
  const label =
    status === 'approved' ? '已批准' : status === 'pending' ? '待审批' : '已退回 · 待修改重审';
  expect(screen.getByLabelText(`管理者审批：${label}`).className).toBe(
    status === 'approved' ? 'is-complete' : '',
  );
  const publicationDetail = status === 'approved' ? '已流转排产员 · 待发布' : '待审批通过';
  expect(screen.getByLabelText(`计划发布：${publicationDetail}`).className).toBe('');
  if (status === 'approved') {
    expect(
      screen.getByLabelText(`计划发布：${publicationDetail}`).getAttribute('aria-current'),
    ).toBe('step');
  }
});

it('opens review details only for the current reviewed analysis', () => {
  const onReview = vi.fn();
  const state = { ...workbench, fault_review: review };
  const view = render(
    <FaultProgress state={state} workflow={workflow} simulation={simulation} onReview={onReview} />,
  );
  fireEvent.click(screen.getByRole('button', { name: '审批详情' }));
  expect(onReview).toHaveBeenCalledOnce();
  view.rerender(
    <FaultProgress
      state={state}
      workflow={workflow}
      simulation={{ ...simulation, id: 'new' }}
      onReview={onReview}
    />,
  );
  expect(screen.queryByRole('button', { name: '审批详情' })).toBeNull();
});

it('requires fresh approval for regenerated analysis and restores all completed stages after publication', () => {
  const view = render(
    <FaultProgress
      state={{ ...workbench, fault_review: review }}
      workflow={workflow}
      simulation={{ ...simulation, id: 'regenerated' }}
    />,
  );
  expect(screen.getByLabelText('管理者审批：待提交').className).toBe('');
  view.rerender(
    <FaultProgress
      state={{
        ...workbench,
        baseline: { ...workbench.baseline, version: 4 },
        plan_publication: {
          version: 4,
          published_by: 'planner_01',
          version_summary: '故障调整计划',
          published_at: workbench.snapshot_time,
          fault_analysis: {
            event_revision: workbench.event_revision,
            baseline_version: 3,
            affected: ['op'],
            workflow,
          },
        },
      }}
      workflow={null}
    />,
  );
  expect(screen.getByLabelText('计划发布：已发布 V4').className).toBe('is-complete');
  expect(
    screen.getByRole('list', { name: '故障处理流程' }).querySelectorAll('.is-complete'),
  ).toHaveLength(4);
});
