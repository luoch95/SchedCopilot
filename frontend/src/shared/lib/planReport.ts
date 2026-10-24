import type { OrderImpact } from '../api/contracts';

/** A net zero never proves that every order is unchanged. */
export function planReport(impacts: OrderImpact[] | undefined) {
  if (
    !impacts?.length ||
    new Set(impacts.map((item) => item.订单)).size !== impacts.length ||
    impacts.some(
      (item) =>
        !item.订单 ||
        !Number.isFinite(item['原延期(分钟)']) ||
        item['原延期(分钟)'] < 0 ||
        !Number.isFinite(item['新延期(分钟)']) ||
        item['新延期(分钟)'] < 0,
    )
  )
    return null;
  const total = impacts.reduce((sum, item) => sum + item['新延期(分钟)'], 0);
  const baseline = impacts.reduce((sum, item) => sum + item['原延期(分钟)'], 0);
  const late = impacts.filter((item) => item['新延期(分钟)'] > 0);
  const worsened = impacts.filter((item) => item['新延期(分钟)'] > item['原延期(分钟)']);
  return { total, baseline, late, worsened, delta: total - baseline };
}
