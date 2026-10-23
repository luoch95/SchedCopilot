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
  it('excludes validation from the mean and displays two decimal places', () => {
    const result = workflow([98, 90, 80, 70]);
    render(<TrustScore result={result} />);
    expect(screen.getByText('80.00%')).toBeTruthy();
    expect(screen.getAllByText(/综合信任度/)).toHaveLength(1);
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
    expect(screen.getByText('未评分')).toBeTruthy();
  });
});
