import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WorkflowResult } from '../../shared/api/contracts';
import { simulation } from '../../test/fixtures';
import { EvaluationSummary } from './EvaluationSummary';

const result: WorkflowResult = {
  id: 'evaluation',
  intent: 'generate_candidates',
  status: 'completed',
  failure_code: null,
  trace: [],
  results: {
    evaluation: {
      status: 'success',
      errors: [],
      warnings: [],
      data: {
        evaluations: simulation.candidates.map((candidate) => ({
          candidate_id: candidate.id,
          metrics_ref: candidate.id,
          missing_metrics: [],
        })),
      },
    },
  },
  evidence_catalog: Object.fromEntries(
    simulation.candidates.map((candidate, i) => [
      candidate.id,
      {
        kind: 'evaluation_metrics',
        content: {
          changeovers: 5,
          changeover_minutes: 75,
          machine_loads: [
            {
              machine_id: 'M1',
              changeovers: i === 0 ? 2 : 1,
              setup_minutes: i === 0 ? 30 : 15,
              utilization: i === 0 ? 0.46875 : 0.359375,
            },
          ],
        },
      },
    ]),
  ),
};

describe('evaluation comparison', () => {
  it('uses candidate columns and distinguishes device distribution when totals match', () => {
    render(<EvaluationSummary result={result} simulation={simulation} />);
    const table = screen.getByRole('table', { name: '方案评估对比表' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((node) => node.textContent),
    ).toEqual(['评估项目', '原计划对照', '允许合格设备转移']);
    const counts = within(table).getByRole('row', { name: /M1 换型次数/ });
    expect(
      within(counts)
        .getAllByRole('cell')
        .map((node) => node.textContent),
    ).toEqual(['2 次 / 30 分钟', '1 次 / 15 分钟']);
    expect(within(table).getAllByText('5 次')).toHaveLength(2);
    expect(within(table).getAllByText('5 次 × 15 分钟＝75 分钟')).toHaveLength(2);
    expect(screen.getByText(/换型总量相同/)).toBeTruthy();
  });

  it('keeps unavailable metrics unknown rather than showing zero or equal totals', () => {
    render(
      <EvaluationSummary result={{ ...result, evidence_catalog: {} }} simulation={simulation} />,
    );
    expect(screen.getAllByText('未计算').length).toBeGreaterThan(0);
    expect(screen.queryByText('0 次')).toBeNull();
    expect(screen.queryByText(/换型总量相同/)).toBeNull();
  });

  it.each([
    [0.6, '60.0% ↑ 上升 13.1 个百分点'],
    [0.359375, '35.9% ↓ 下降 11.0 个百分点'],
    [0.46875, '46.9%（持平）'],
  ])(
    'compares utilization with the reference even when columns are reversed: %s',
    (value, expected) => {
      const transferId = simulation.candidates[1].id;
      const evidence = structuredClone(result.evidence_catalog);
      evidence[transferId].content = {
        machine_loads: [{ machine_id: 'M1', utilization: value }],
      };
      render(
        <EvaluationSummary
          result={{ ...result, evidence_catalog: evidence }}
          simulation={{ ...simulation, candidates: [...simulation.candidates].reverse() }}
        />,
      );
      const row = screen.getByRole('row', { name: /M1 班次利用率/ });
      expect(row.textContent).toContain(expected);
      expect(within(row).getByText('46.9%（基准）')).toBeTruthy();
    },
  );

  it('does not infer a change when reference utilization is missing', () => {
    const evidence = { ...result.evidence_catalog };
    delete evidence[simulation.candidates[0].id];
    render(
      <EvaluationSummary
        result={{ ...result, evidence_catalog: evidence }}
        simulation={simulation}
      />,
    );
    const row = screen.getByRole('row', { name: /M1 班次利用率/ });
    expect(within(row).getByText('35.9%')).toBeTruthy();
    expect(row.textContent).not.toMatch(/[↑↓]/);
  });
});
