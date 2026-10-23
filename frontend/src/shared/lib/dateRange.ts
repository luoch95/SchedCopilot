import { localInput } from './time';

export interface DateRange {
  start: string;
  end: string;
}

/** Inclusive calendar dates in the shop floor's timezone (Asia/Shanghai). */
export function inDateRange(timestamp: string, range?: DateRange) {
  if (!range || (!range.start && !range.end)) return true;
  if (!Number.isFinite(Date.parse(timestamp))) return false;
  const day = localInput(timestamp).slice(0, 10);
  return (!range.start || day >= range.start) && (!range.end || day <= range.end);
}

export function newestFirst(left: string, right: string) {
  const time = (value: string) => (Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0);
  return time(right) - time(left);
}
