import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { workbench } from '../../test/fixtures';
import { EventIssues } from './EventIssues';
import { explainIssue } from './model';

describe('故障执行记录说明', () => {
  it('使用真实快照时间并说明其他设备的报工缺失，不建议修改真实故障时间', () => {
    const state = {
      ...workbench,
      snapshot_time: '2026-10-19T14:30:00+08:00',
      event: { ...workbench.event, machine_id: 'M2', started_at: '2026-10-19T16:00:00+08:00' },
      issues: ['报工状态过期：O1-OP1 在事件之前应已开工，请先确认状态'],
    };
    render(<EventIssues state={state} />);
    expect(screen.getByRole('alert').textContent).toContain('14:30');
    expect(screen.getByText(/O1-OP1（M1）/).textContent).toContain('待加工');
    expect(screen.getByText(/校验范围是整个执行计划/)).toBeTruthy();
    expect(screen.getByText(/当前页面仅能录入故障，不能更新工序报工/)).toBeTruthy();
    expect(screen.getByText(/真实故障应保留实际时间/)).toBeTruthy();
    expect(screen.queryByText(/请使用13:00模拟/)).toBeNull();
  });

  it('不隐藏未知问题，并准确区分已开工状态', () => {
    const state = {
      ...workbench,
      baseline: {
        ...workbench.baseline,
        operations: [{ ...workbench.baseline.operations[0], status: 'in_progress' as const }],
      },
    };
    expect(explainIssue(state, '加工中故障：O1-OP1 涉及已开工或已完成工序')).toContain(
      '当前报工状态为“加工中”',
    );
    expect(explainIssue(state, '未知校验问题')).toBe('未知校验问题');
    const { container } = render(<EventIssues state={state} />);
    expect(container.textContent).toBe('');
  });
});
