import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Gantt from './Gantt';
import { simulation, workbench } from '../../test/fixtures';

const range: [number, number] = [
  +new Date('2026-10-19T13:00:00+08:00'),
  +new Date('2026-10-19T18:00:00+08:00'),
];

describe('Gantt baseline comparison', () => {
  it('shows candidate timing and its reason without drawing old-position boxes', () => {
    const candidate = simulation.candidates[0];
    const before = workbench.baseline.operations[0];
    const after = candidate.schedule.operations[0];
    render(
      <Gantt
        schedule={candidate.schedule}
        baseline={workbench.baseline}
        failure={workbench.event}
        machines={workbench.machines}
        range={range}
        changes={[
          {
            工序: before.id,
            订单: before.order_id,
            类型: '直接影响',
            原设备: before.machine_id,
            新设备: after.machine_id,
            原开始: before.start,
            新开始: after.start,
            原结束: before.end,
            新结束: after.end,
            '时间变化(分钟)': 240,
            依据: '故障:M1',
            影响链: '故障:M1 → O1-OP1',
          },
        ]}
      />,
    );
    expect(screen.queryByRole('graphics-symbol', { name: /^原安排/ })).toBeNull();
    const moved = screen.getByRole('graphics-symbol', { name: /^O1-OP1 M1.*时间调整$/ });
    fireEvent.focus(moved);
    expect(screen.getByText('调整依据：故障:M1')).toBeTruthy();
    expect(workbench.baseline.operations[0].start).toBe('2026-10-19T13:00:00+08:00');
  });

  it('draws only the new machine position after transfer', () => {
    render(
      <Gantt
        schedule={simulation.candidates[1].schedule}
        baseline={workbench.baseline}
        failure={workbench.event}
        machines={workbench.machines}
        range={range}
      />,
    );
    expect(screen.queryByRole('graphics-symbol', { name: /^原安排/ })).toBeNull();
    const moved = screen.getByRole('graphics-symbol', { name: /^O1-OP1 M2.*设备转移$/ });
    expect(moved.getAttribute('stroke')).toBe('#7C3AED');
    expect(screen.getAllByRole('graphics-symbol')).toHaveLength(1);
  });
});
