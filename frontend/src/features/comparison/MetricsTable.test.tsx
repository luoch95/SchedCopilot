import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { MetricsTable } from './MetricsTable';
import { simulation } from '../../test/fixtures';
import type { ManualFaultDraft } from '../../shared/api/contracts';

it('separates existing lateness, incremental lateness and edits relative to the source even when total metrics tie', () => {
  const source = {
    ...simulation.candidates[0],
    label: 'AI 原线等待方案',
    metrics: {
      ...simulation.candidates[0].metrics,
      total_lateness_minutes: 215,
      moved_operations: 4,
    },
  };
  const manual = {
    ...source,
    id: 'manual:draft:2',
    label: '人工调整方案',
    schedule: {
      ...source.schedule,
      operations: source.schedule.operations.map((op) => ({ ...op, machine_id: 'M2' })),
    },
    order_impacts: [
      {
        ...source.order_impacts[0],
        '原延期(分钟)': 165,
        '新延期(分钟)': 215,
        '新增延期(分钟)': 50,
      },
    ],
  };
  render(
    <MetricsTable
      candidates={[source, manual]}
      manualDraft={
        {
          origin: source.schedule,
          simulation: { ...simulation, candidates: [manual] },
        } as ManualFaultDraft
      }
    />,
  );
  expect(
    within(screen.getByRole('row', { name: /总延期 \/ 分钟/ }))
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['215', '215']);
  expect(
    within(screen.getByRole('row', { name: /新增延期（相对执行计划）/ })).getAllByRole('cell')[1]
      .textContent,
  ).toContain('50');
  expect(
    within(screen.getByRole('row', { name: /调整工序（相对执行计划）/ })).getAllByRole('cell')[1]
      .textContent,
  ).toBe('4');
  expect(
    within(screen.getByRole('row', { name: /人工修改工序（相对编辑起点）/ }))
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['—', '1']);
});
