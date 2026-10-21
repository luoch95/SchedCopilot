import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DateRangeFilter } from './DateRangeFilter';

it('selects a range across both months in either direction', () => {
  const onChange = vi.fn();
  render(
    <DateRangeFilter
      initialRange={{ start: '2026-10-19', end: '2026-10-20' }}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /时间范围：/ }));
  const calendar = screen.getByRole('dialog', { name: '选择日期范围' });
  expect(within(calendar).getByRole('region', { name: '2026年10月' })).toBeTruthy();
  expect(within(calendar).getByRole('region', { name: '2026年11月' })).toBeTruthy();
  fireEvent.click(within(calendar).getByRole('button', { name: '2026-11-02' }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.mouseEnter(within(calendar).getByRole('button', { name: '2026-10-30' }));
  expect(
    within(calendar).getByRole('button', { name: '2026-11-01' }).getAttribute('aria-pressed'),
  ).toBe('true');
  fireEvent.click(within(calendar).getByRole('button', { name: '2026-10-30' }));
  expect(onChange).toHaveBeenLastCalledWith({ start: '2026-10-30', end: '2026-11-02' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText('10/30 - 11/02')).toBeTruthy();
});

it('cancels an unfinished range and navigates across a year boundary', () => {
  const onChange = vi.fn();
  render(
    <DateRangeFilter
      initialRange={{ start: '2026-12-19', end: '2026-12-20' }}
      onChange={onChange}
    />,
  );
  const trigger = screen.getByRole('button', { name: /时间范围：/ });
  trigger.focus();
  fireEvent.click(trigger);
  const calendar = screen.getByRole('dialog');
  fireEvent.click(within(calendar).getByRole('button', { name: '下个月' }));
  expect(within(calendar).getByRole('region', { name: '2027年1月' })).toBeTruthy();
  fireEvent.click(within(calendar).getByRole('button', { name: '2027-01-01' }));
  fireEvent.click(within(calendar).getByRole('button', { name: '关闭' }));
  expect(onChange).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
  expect(screen.getByText('12/19 - 12/20')).toBeTruthy();
});
