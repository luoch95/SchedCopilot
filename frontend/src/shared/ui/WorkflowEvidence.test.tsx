import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { WorkflowResult } from '../api/contracts';
import { DecisionText } from './DecisionText';
import { WorkflowNotices } from './WorkflowEvidence';

const result: WorkflowResult = {
  id: 'saved-report',
  intent: 'generate_candidates',
  status: 'completed',
  failure_code: null,
  trace: [],
  results: {},
  evidence_catalog: {},
};

it('shows unchecked conditions in Chinese in saved notices and limitation text without mutating reports', () => {
  const conditions = ['material_availability', 'staffing', 'mold_maintenance'];
  const notices = conditions.map((message) => ({
    code: 'EXPLANATION_PARTIAL',
    message,
    repair_hint: '补充所缺证据后重新解释。',
    evidence_refs: ['validation'],
  }));
  const before = JSON.stringify(notices);
  render(
    <>
      <WorkflowNotices result={result} notices={notices} />
      {conditions.map((text) => (
        <p key={text}>
          <DecisionText text={text} />
        </p>
      ))}
    </>,
  );
  for (const label of ['物料可用性', '人员配置', '模具维护状态']) {
    expect(screen.getAllByText(`尚未核验的生产条件：${label}；执行前需人工确认。`)).toHaveLength(2);
  }
  expect(screen.queryByText('补充所缺证据后重新解释。')).toBeNull();
  expect(screen.getAllByText('请根据上述限制核实适用条件，执行前由计划员确认。')).toHaveLength(3);
  for (const condition of conditions) expect(document.body.textContent).not.toContain(condition);
  expect(JSON.stringify(notices)).toBe(before);
});

it('retains real missing-evidence errors, custom repair hints and unknown limitations', () => {
  render(
    <>
      <WorkflowNotices
        result={result}
        notices={[
          {
            code: 'EVIDENCE_REQUIRED',
            message: '缺少候选方案证据，无法评估。',
            repair_hint: '补充所缺证据后重新解释。',
            evidence_refs: [],
          },
        ]}
      />
      <DecisionText text="unknown_condition" />
    </>,
  );
  expect(screen.getByText('缺少候选方案证据，无法评估。')).toBeTruthy();
  expect(screen.getByText('补充所缺证据后重新解释。')).toBeTruthy();
  expect(screen.getByText('unknown_condition')).toBeTruthy();
});
