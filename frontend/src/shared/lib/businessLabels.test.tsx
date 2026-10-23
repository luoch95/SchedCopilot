import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BusinessLabelProvider } from './BusinessLabelProvider';
import { WorkflowDebugDetails, WorkflowStatements } from '../ui/WorkflowEvidence';
import { DecisionText } from '../ui/DecisionText';
import { workbench } from '../../test/fixtures';
import type { WorkflowResult } from '../api/contracts';

const workflow: WorkflowResult = {
  id: 'workflow-1',
  intent: 'generate_candidates',
  status: 'completed',
  failure_code: null,
  trace: [],
  results: {},
  evidence_catalog: {},
};

it('uses request numbers in operation explanations, impact chains and nested evidence without mutating IDs', () => {
  const orderId = 'URG-b2144663-1234-4321-8765-abcdef012345';
  const operationId = `${orderId}-OP1`;
  const op = {
    ...workbench.baseline.operations[0],
    id: operationId,
    order_id: orderId,
    display_name: 'URG-20261020-001-OP1',
    order_display_name: 'URG-20261020-001',
  };
  const evidence = { operation_id: operationId, order_id: orderId };
  render(
    <BusinessLabelProvider operations={[op]}>
      <DecisionText text={`工序 ${operationId} 调整，因此订单 ${orderId} 延期。`} />
      <WorkflowDebugDetails data={evidence} />
      <WorkflowStatements
        result={workflow}
        title="取舍"
        items={[{ text: orderId, evidence_refs: [] }]}
      />
    </BusinessLabelProvider>,
  );
  expect(document.body.textContent).not.toContain('b2144663');
  expect(screen.getByText(/工序 URG-20261020-001-OP1 调整/)).toBeTruthy();
  expect(document.body.textContent).toContain('因此订单 URG-20261020-001 延期。');
  expect(evidence.operation_id).toBe(operationId);
  expect(op.order_id).toBe(orderId);
});
