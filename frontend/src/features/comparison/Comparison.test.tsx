import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Comparison } from './Comparison';
import { simulation, workbench } from '../../test/fixtures';
import type { WorkflowResult } from '../../shared/api/contracts';

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
  const tail = screen.getByRole('article', { name: 'AI 原线等待方案排产图' });
  expect(within(baseline).getByRole('graphics-symbol').getAttribute('aria-label')).toContain(
    '10/19 13:00',
  );
  expect(within(tail).getByRole('graphics-symbol').getAttribute('aria-label')).toContain(
    '10/20 00:00',
  );
  expect(within(baseline).queryByRole('group', { name: 'M1 停机留痕' })).toBeNull();
  expect(within(tail).getByRole('group', { name: 'M1 停机留痕' })).toBeTruthy();
  expect(within(tail).getByRole('heading', { name: 'AI 原线等待方案' })).toBeTruthy();
  expect(screen.getAllByRole('img', { name: '设备工序甘特图' })).toHaveLength(2);
  expect(within(baseline).queryByRole('button', { name: /^采纳/ })).toBeNull();
  expect(within(tail).getByRole('button', { name: '采纳 AI 等待方案' })).toBeTruthy();
  expect(screen.queryByText('AI 允许转移')).toBeNull();
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
  const waiting = screen.getByRole('article', { name: 'AI 原线等待方案排产图' });
  const transfer = screen.getByRole('article', { name: 'AI 允许转移方案排产图' });
  expect(
    within(waiting).getByRole('button', { name: '采纳 AI 等待方案' }).classList.contains('primary'),
  ).toBe(false);
  expect(
    within(transfer)
      .getByRole('button', { name: '采纳 AI 转移方案' })
      .classList.contains('primary'),
  ).toBe(true);
  expect(screen.queryByText('已选中')).toBeNull();
  fireEvent.click(within(waiting).getByRole('button', { name: '采纳 AI 等待方案' }));
  expect(onAdopt).toHaveBeenLastCalledWith('wait');
  fireEvent.click(within(transfer).getByRole('button', { name: '采纳 AI 转移方案' }));
  expect(onAdopt).toHaveBeenLastCalledWith('transfer');
  expect(within(transfer).getByText('AI 允许转移')).toBeTruthy();
  expect(within(waiting).queryByText('AI 允许转移')).toBeNull();
  expect(transfer.getAttribute('data-selected')).toBe('true');
  rerender(<Comparison {...props} adoption={{ ...props.adoption, selected: 'wait' }} />);
  expect(
    screen.getByRole('button', { name: '采纳 AI 等待方案' }).classList.contains('primary'),
  ).toBe(true);
  expect(
    screen.getByRole('button', { name: '采纳 AI 转移方案' }).classList.contains('primary'),
  ).toBe(false);
  rerender(<Comparison {...props} adoption={{ ...props.adoption, disabled: true }} />);
  fireEvent.click(screen.getByRole('button', { name: '采纳 AI 等待方案' }));
  expect(onAdopt).toHaveBeenCalledTimes(2);
  rerender(<Comparison {...props} archived />);
  expect(screen.queryByRole('button', { name: /^采纳/ })).toBeNull();
  expect(screen.queryByText('AI 允许转移')).toBeNull();
});

it('uses original workflow strategy IDs after titles change and does not classify manual or unknown plans as transfer', () => {
  const waiting = {
    ...simulation.candidates[0],
    id: 'opaque-wait-id',
    label: '原 AI 方案（任意名称）',
  };
  const manual = { ...simulation.candidates[1], id: 'manual:draft:2', label: '任意人工标题' };
  const unknown = { ...simulation.candidates[0], id: 'unknown', label: '原计划对照' };
  render(
    <Comparison
      state={workbench}
      simulation={{ ...simulation, candidates: [waiting, manual, unknown] }}
      range={[
        Date.parse(workbench.event.started_at),
        Date.parse(waiting.schedule.operations[0].end),
      ]}
      workflow={null}
      referenceWorkflow={
        {
          results: {
            scheduling: {
              data: { candidates: [{ candidate_id: waiting.id, strategy_id: 'wait-recovery' }] },
            },
          },
        } as WorkflowResult
      }
      mode="plans"
      adoption={{ selected: '', disabled: false, onAdopt: vi.fn() }}
    />,
  );
  const waitingCard = screen.getByRole('article', { name: 'AI 原线等待方案排产图' });
  expect(within(waitingCard).getByRole('button', { name: '采纳 AI 等待方案' })).toBeTruthy();
  expect(within(waitingCard).getByRole('graphics-symbol').getAttribute('fill')).toBe('#527DA8');
  expect(screen.getByRole('button', { name: '采纳人工方案' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '采纳此方案' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '采纳 AI 转移方案' })).toBeNull();
  expect(screen.queryByText('AI 允许转移')).toBeNull();
});
