import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { WorkflowResult } from '../../shared/api/contracts';
import { simulation } from '../../test/fixtures';
import { AnalysisDetailCards } from './AnalysisDetailCards';

const reference = 'candidate-batch:3dc72c1234567890abcdef';
const result: WorkflowResult = {
  id: 'workflow',
  intent: 'generate_candidates',
  status: 'completed',
  failure_code: null,
  trace: [],
  results: {
    explanation: {
      status: 'success',
      errors: [],
      warnings: [],
      data: {
        facts: [
          { text: '主要事实', evidence_refs: [] },
          { text: '候选总延期 120 分钟，原计划为 0 分钟。', evidence_refs: ['metrics'] },
          { text: '因此需要人工确认。', evidence_refs: ['metrics'] },
          { text: `批次 ${reference}`, evidence_refs: [] },
        ],
        risks: [
          { text: '首项风险', evidence_refs: [] },
          { text: '预计恢复需确认', evidence_refs: [] },
        ],
        limitations: ['人员配置未检查'],
      },
    },
    evaluation: {
      status: 'success',
      errors: [],
      warnings: [],
      data: {
        evaluations: [
          {
            candidate_id: simulation.candidates[0].id,
            metrics_ref: 'metrics',
            missing_metrics: [],
          },
        ],
      },
    },
  },
  evidence_catalog: {
    metrics: {
      kind: 'evaluation_metrics',
      content: {
        changeovers: 0,
        machine_loads: [{ machine_id: 'M1', utilization: 0.625 }],
      },
    },
  },
};

it('switches candidate snapshots together and distinguishes zero from uncomputed metrics', () => {
  render(<AnalysisDetailCards result={result} simulation={simulation} />);
  const metrics = screen.getByRole('region', { name: '指标核算' });
  expect(within(metrics).getByText('62.5%')).toBeTruthy();
  expect(within(metrics).getByText('换型次数').nextElementSibling?.textContent).toBe('0次');
  expect(screen.getByRole('table', { name: '订单完工与延期快照' })).toBeTruthy();
  expect(screen.queryByText('候选总延期 120 分钟，原计划为 0 分钟。')).toBeNull();
  expect(screen.getByText('预计恢复需确认')).toBeTruthy();
  expect(screen.getByText('因此需要人工确认。').tagName).toBe('STRONG');
  expect(screen.getByText('人员配置未检查')).toBeTruthy();
  expect(screen.getByTitle(reference).textContent).toBe('关联证据');
  expect(document.body.textContent).not.toContain(reference);
  fireEvent.change(screen.getByRole('combobox', { name: '查看方案' }), {
    target: { value: simulation.candidates[1].id },
  });
  expect(within(metrics).queryByText('62.5%')).toBeNull();
  expect(within(metrics).getByText('换型次数').nextElementSibling?.textContent).toBe('—未计算');
});

it('retains all supplementary facts when there is no structured candidate', () => {
  render(<AnalysisDetailCards result={result} />);
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getByText('候选总延期 120 分钟，原计划为 0 分钟。')).toBeTruthy();
  expect(screen.getByText('人员配置未检查')).toBeTruthy();
});
