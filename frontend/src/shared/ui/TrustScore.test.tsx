import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { QualityReport, WorkflowResult } from '../api/contracts';
import { TrustScore, workflowTrust } from './TrustScore';

function workflow(scores: (number | null)[]): WorkflowResult {
  return {
    id: 'scored',
    intent: 'generate_candidates',
    status: 'completed',
    failure_code: null,
    trace: [],
    evidence_catalog: {},
    results: Object.fromEntries(
      ['validation', 'scheduling', 'evaluation', 'explanation'].map((role, i) => [
        role,
        {
          status: 'warning',
          data: null,
          errors: [],
          warnings: [],
          quality: {
            version: 'AGD-V1.3-I1',
            outcome: 'warning',
            round: 1,
            score: scores[i],
            score_version: 'rules-v1',
            issues: [],
            stop_reason: null,
            history: [],
          } satisfies QualityReport,
        },
      ]),
    ),
  };
}

describe('workflow trust score', () => {
  it('keeps technical scores separate from a missing validation record', () => {
    const result = workflow([98, 90, 80, 70]);
    expect(workflowTrust(result)).toBe(80);
    render(<TrustScore result={result} />);
    expect(screen.getByText('约束校验记录不完整，暂无法确认')).toBeTruthy();
    expect(screen.queryByText(/综合信任度|80.00%/)).toBeNull();
  });

  it.each([
    [97.99, 90, 90, 90],
    [null, 90, 90, 90],
    [98, null, 90, 90],
    [98, Number.NaN, 90, 90],
    [98, 101, 90, 90],
  ])('does not invent a total for missing or invalid scores: %j', (...scores) => {
    expect(workflowTrust(workflow(scores))).toBeNull();
  });

  it('does not score an unfinished or failed workflow', () => {
    const result = workflow([98, 70, 70, 70]);
    result.status = 'failed';
    expect(workflowTrust(result)).toBeNull();
    render(<TrustScore result={null} />);
    expect(screen.getByText('约束校验记录不完整，暂无法确认')).toBeTruthy();
  });

  it('counts distinct unchecked conditions from the validated result, not the score', () => {
    const result = workflow([100, 70, 70, 70]);
    result.results.validation!.data = {
      can_generate_candidates: true,
      checked_items: ['machine_compatibility'],
      unchecked_items: ['material_availability', 'staffing', 'mold_maintenance', 'staffing'],
      issues: [],
    };
    const view = render(<TrustScore result={result} />);
    expect(screen.getByText('已检查约束通过，另有 3 项生产条件待核验')).toBeTruthy();
    expect(screen.getByText(/已检查约束通过/).closest('details')?.title).toContain('物料可用性');
    expect(screen.getByText('评估可信度：25%')).toBeTruthy();
    result.results.validation!.data.unchecked_items = [];
    view.rerender(<TrustScore result={result} />);
    expect(screen.getByText('已检查约束通过，无待核验生产条件')).toBeTruthy();
    expect(screen.getByText('评估可信度：100%')).toBeTruthy();
  });

  it.each(['blocked', 'failed', 'missing'] as const)(
    'never claims passed checks for %s validation',
    (state) => {
      const result = workflow([100, 70, 70, 70]);
      result.results.validation!.data =
        state === 'missing'
          ? null
          : {
              can_generate_candidates: true,
              checked_items: ['machines'],
              unchecked_items: [],
              issues: [{ severity: 'blocking', message: '设备不可用' }],
            };
      if (state !== 'missing') result.results.validation!.status = state;
      render(<TrustScore result={result} />);
      expect(screen.queryByText(/已检查约束通过/)).toBeNull();
    },
  );

  it('does not hide failed quality or a missing issue list behind a successful status', () => {
    const result = workflow([100, 70, 70, 70]);
    const validation = result.results.validation!;
    validation.data = {
      can_generate_candidates: true,
      checked_items: ['machines'],
      unchecked_items: [],
      issues: [],
    };
    validation.quality!.outcome = 'failed';
    const view = render(<TrustScore result={result} />);
    expect(screen.queryByText(/已检查约束通过/)).toBeNull();
    validation.quality!.outcome = 'passed';
    delete validation.data.issues;
    view.rerender(<TrustScore result={result} />);
    expect(screen.queryByText(/已检查约束通过/)).toBeNull();
  });
});
