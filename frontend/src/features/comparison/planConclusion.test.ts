import { expect, it } from 'vitest';
import { simulation } from '../../test/fixtures';
import { planConclusion } from './planConclusion';
import type { WorkflowResult } from '../../shared/api/contracts';

it('computes completion gains separately from accumulated delay without changing candidate order', () => {
  const result = planConclusion(simulation.candidates, null);
  expect(result.improved).toBe(true);
  expect(result.headline).toBe(
    '建议优先采用【允许合格设备转移】：预计整体提前 240 分钟完工，累计延期减少 120 分钟。',
  );
  expect(result.context).toContain('相较【原计划对照】');
  expect(simulation.candidates.map((item) => item.id)).toEqual(['wait', 'transfer']);
});

it('does not describe reduced accumulated delay as earlier completion when makespans match', () => {
  const [reference, transfer] = simulation.candidates;
  const result = planConclusion(
    [
      { ...reference, metrics: { ...reference.metrics, total_lateness_minutes: 255 } },
      {
        ...transfer,
        metrics: {
          ...transfer.metrics,
          total_lateness_minutes: 45,
          makespan: reference.metrics.makespan,
        },
      },
    ],
    null,
  );
  expect(result.headline).toContain('累计延期减少 210 分钟');
  expect(result.headline).not.toContain('提前');
});

it('uses the scheduling strategy as the reference even if its display label changes', () => {
  const result = planConclusion(
    simulation.candidates.map((item) =>
      item.id === 'wait' ? { ...item, label: '故障后顺延' } : item,
    ),
    {
      results: {
        scheduling: {
          data: { candidates: [{ candidate_id: 'wait', strategy_id: 'wait-recovery' }] },
        },
      },
    } as WorkflowResult,
  );
  expect(result.improved).toBe(true);
  expect(result.context).toContain('相较【故障后顺延】');
});

it('does not invent comparative benefits for a single candidate or incomplete metrics', () => {
  const transfer = simulation.candidates[1];
  const only = planConclusion([transfer], null);
  expect(only.improved).toBe(false);
  expect(only.headline).not.toContain('提前');
  expect(only.context).toContain('仅有一套');
  const missing = planConclusion(
    [{ ...transfer, metrics: { ...transfer.metrics, makespan: 'invalid' } }],
    null,
  );
  expect(missing.improved).toBe(false);
  expect(missing.headline).toBe('候选方案已生成，请核对指标后选择。');
});
