import { describe, expect, it } from 'vitest';
import { inDateRange, newestFirst } from './dateRange';

describe('shop floor calendar filtering', () => {
  it('includes the whole end date in Beijing time across UTC midnight boundaries', () => {
    const range = { start: '2026-10-19', end: '2026-10-19' };
    expect(inDateRange('2026-10-18T16:00:00Z', range)).toBe(true);
    expect(inDateRange('2026-10-19T15:59:59.999Z', range)).toBe(true);
    expect(inDateRange('2026-10-18T15:59:59.999Z', range)).toBe(false);
    expect(inDateRange('2026-10-19T16:00:00Z', range)).toBe(false);
  });
  it('supports open date boundaries and compares actual timestamps', () => {
    expect(inDateRange('2026-10-20T00:00:00+08:00', { start: '2026-10-19', end: '' })).toBe(true);
    expect(inDateRange('2026-10-18T00:00:00+08:00', { start: '', end: '2026-10-19' })).toBe(true);
    expect(inDateRange('invalid', { start: '2026-10-19', end: '' })).toBe(false);
    expect(['2026-10-19T02:00:00Z', '2026-10-19T11:00:00+08:00'].sort(newestFirst)).toEqual([
      '2026-10-19T11:00:00+08:00',
      '2026-10-19T02:00:00Z',
    ]);
  });
});
