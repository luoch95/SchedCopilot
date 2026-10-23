import type { InsertionAssessment } from '../../shared/api/contracts';

/** Use the owning request number for legacy snapshots as well as new trials. */
export function operationLabels(
  result: InsertionAssessment,
  op: InsertionAssessment['details']['operations'][number],
  requestNo = result.request_no,
) {
  const inserted = op.order_id === result.details.inserted_order_id;
  return {
    display_name:
      inserted && requestNo
        ? `${requestNo}-OP${op.sequence}`
        : (op.display_name ?? op.operation_id),
    order_display_name: inserted && requestNo ? requestNo : (op.order_display_name ?? op.order_id),
  };
}
