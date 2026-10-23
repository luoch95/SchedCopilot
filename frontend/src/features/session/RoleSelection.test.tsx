import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RoleSelection } from './RoleSelection';

it('offers three whole-card role buttons in business order with no carousel controls', () => {
  const onSelect = vi.fn();
  render(<RoleSelection onSelect={onSelect} />);
  const buttons = screen.getAllByRole('button');
  expect(buttons).toHaveLength(3);
  expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
    '进入管理者审批',
    '进入业务员页面',
    '进入排产工作台',
  ]);
  fireEvent.click(screen.getByText('查看交期与影响摘要，审批或驳回插单申请。'));
  expect(onSelect).toHaveBeenLastCalledWith('leader');
  fireEvent.click(screen.getByText('业务员'));
  expect(onSelect).toHaveBeenLastCalledWith('sales');
  fireEvent.click(screen.getByText('排产计划员'));
  expect(onSelect).toHaveBeenLastCalledWith('planner');
  expect(onSelect).toHaveBeenCalledTimes(3);
  expect(screen.queryByLabelText('下一个角色')).toBeNull();
  expect(screen.getByText(/演示模式：无需账号密码，点击角色卡片进入对应工作空间。/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '研发后台' }).getAttribute('href')).toBe('/admin');
});
