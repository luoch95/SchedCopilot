import type { Operation } from '../api/contracts';

export type BusinessOperation = Pick<
  Operation,
  'id' | 'order_id' | 'display_name' | 'order_display_name'
>;

/** Translate presentation text only; retain internal IDs for selection and API calls. */
export function businessText(text: string, operations: BusinessOperation[]) {
  const labels = new Map<string, string>();
  for (const op of operations) {
    if (op.display_name) labels.set(op.id, op.display_name);
    if (op.order_display_name) labels.set(op.order_id, op.order_display_name);
  }
  // Replace in one pass, longest first, so an order ID cannot eat an operation ID.
  const keys = [...labels.keys()].sort((a, b) => b.length - a.length);
  if (!keys.length) return text;
  const pattern = keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return text.replace(new RegExp(pattern, 'g'), (id) => labels.get(id)!);
}
