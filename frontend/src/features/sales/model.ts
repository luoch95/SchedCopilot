export interface SalesDraft {
  productId: string;
  quantity: string;
  earliestStart: string;
  due: string;
  reason: string;
}
export type DraftErrors = Partial<Record<keyof SalesDraft, string>>;

// datetime-local values on this page explicitly use Beijing time, not browser timezone.
export function beijingTime(value: string) {
  return new Date(`${value}:00+08:00`).getTime();
}
export function validateDraft(
  draft: SalesDraft,
  productIds: string[],
  snapshot: string,
): DraftErrors {
  const errors: DraftErrors = {};
  if (!productIds.includes(draft.productId)) errors.productId = '请选择模拟产品。';
  if (
    !/^\d+$/.test(draft.quantity) ||
    Number(draft.quantity) < 1 ||
    Number(draft.quantity) > 1000000
  )
    errors.quantity = '数量必须是 1 至 1000000 的整数。';
  const start = beijingTime(draft.earliestStart);
  const due = beijingTime(draft.due);
  if (!Number.isFinite(start)) errors.earliestStart = '请填写最早开工时间。';
  else if (start < Date.parse(snapshot))
    errors.earliestStart = '最早开工时间不能早于当前演示快照。';
  if (!Number.isFinite(due)) errors.due = '请填写要求交期。';
  else if (Number.isFinite(start) && due <= start) errors.due = '要求交期必须晚于最早开工时间。';
  if (!draft.reason.trim()) errors.reason = '请填写紧急原因。';
  else if (draft.reason.trim().length > 1000) errors.reason = '紧急原因不能超过 1000 字。';
  return errors;
}
