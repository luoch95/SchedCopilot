import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Comparison } from './Comparison';
import { simulation, workbench } from '../../test/fixtures';

it('compares the actual published plan with a single tail candidate across midnight', () => {
  const original = simulation.candidates[0];
  const candidate = {
    ...original,
    label: '原线排尾顺延（需确认超班）',
    schedule: {
      ...original.schedule,
      operations: original.schedule.operations.map((operation) => ({
        ...operation,
        start: '2026-10-20T00:00:00+08:00',
        end: '2026-10-20T01:00:00+08:00',
      })),
    },
  };
  render(
    <Comparison
      state={workbench}
      simulation={{ ...simulation, candidates: [candidate] }}
      range={[
        Date.parse(workbench.baseline.operations[0].start),
        Date.parse(candidate.schedule.operations[0].end),
      ]}
      workflow={null}
      mode="plans"
      adoption={{ selected: candidate.id, disabled: false, onAdopt: vi.fn() }}
    />,
  );
  const baseline = screen.getByRole('article', { name: '当前执行计划排产图' });
  const tail = screen.getByRole('article', { name: '原计划对照排产图' });
  expect(within(baseline).getByRole('graphics-symbol').getAttribute('aria-label')).toContain(
    '10/19 13:00',
  );
  expect(within(tail).getByRole('graphics-symbol').getAttribute('aria-label')).toContain(
    '10/20 00:00',
  );
  expect(within(baseline).queryByRole('group', { name: 'M1 停机留痕' })).toBeNull();
  expect(within(tail).getByRole('group', { name: 'M1 停机留痕' })).toBeTruthy();
  expect(within(tail).getByRole('heading', { name: candidate.label })).toBeTruthy();
  expect(screen.getAllByRole('img', { name: '设备工序甘特图' })).toHaveLength(2);
  expect(within(baseline).queryByRole('button', { name: /采纳此方案/ })).toBeNull();
  expect(within(tail).getByRole('button', { name: '采纳此方案（等待恢复）' })).toBeTruthy();
  expect(screen.queryByText('⭐ AI 推荐')).toBeNull();
});

it('binds each card action to its candidate and keeps archives read-only', () => {
  const onAdopt = vi.fn();
  const props = {
    state: workbench,
    simulation,
    range: [Date.parse(workbench.event.started_at), Date.parse(workbench.event.recovered_at!)] as [
      number,
      number,
    ],
    workflow: null,
    mode: 'plans' as const,
    adoption: { selected: 'transfer', disabled: false, onAdopt },
  };
  const { rerender } = render(<Comparison {...props} />);
  const waiting = screen.getByRole('article', { name: '原计划对照排产图' });
  const transfer = screen.getByRole('article', { name: '允许合格设备转移排产图' });
  fireEvent.click(within(waiting).getByRole('button', { name: '采纳此方案（等待恢复）' }));
  expect(onAdopt).toHaveBeenLastCalledWith('wait');
  fireEvent.click(within(transfer).getByRole('button', { name: '采纳此方案（转移设备）' }));
  expect(onAdopt).toHaveBeenLastCalledWith('transfer');
  expect(within(transfer).getByText('⭐ AI 推荐')).toBeTruthy();
  expect(within(waiting).queryByText('⭐ AI 推荐')).toBeNull();
  expect(transfer.getAttribute('data-selected')).toBe('true');
  rerender(<Comparison {...props} adoption={{ ...props.adoption, disabled: true }} />);
  fireEvent.click(screen.getByRole('button', { name: '采纳此方案（等待恢复）' }));
  expect(onAdopt).toHaveBeenCalledTimes(2);
  rerender(<Comparison {...props} archived />);
  expect(screen.queryByRole('button', { name: /采纳此方案/ })).toBeNull();
  expect(screen.queryByText('⭐ AI 推荐')).toBeNull();
});
