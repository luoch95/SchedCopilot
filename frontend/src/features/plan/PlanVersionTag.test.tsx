import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { PlanVersionTag } from './PlanVersionTag';

it('shows saved publication metadata and supports escape and outside close', async () => {
  const user = userEvent.setup();
  render(
    <PlanVersionTag
      version={2}
      publication={{
        version: 2,
        published_at: '2026-10-20T06:41:00Z',
        published_by: 'planner_01',
        version_summary: '发布插单申请 URG-20261020-001，涉及 1 个新增工序和 3 个原订单调整。',
      }}
    />,
  );
  const button = screen.getByRole('button', { name: '查看执行计划 V2 发布信息' });
  expect(screen.queryByRole('region')).toBeNull();
  await user.click(button);
  expect(screen.getByText('发布时间：2026-10-20 14:41')).toBeTruthy();
  expect(screen.getByText('发布人：planner_01')).toBeTruthy();
  expect(screen.getByText(/变更摘要：发布插单申请 URG-20261020-001/)).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('region')).toBeNull();
  await user.click(button);
  await user.click(document.body);
  expect(screen.queryByRole('region')).toBeNull();
});

it('does not invent publication details for the initial plan', async () => {
  render(<PlanVersionTag version={1} />);
  await userEvent.click(screen.getByRole('button'));
  expect(screen.getByText('发布时间：未记录')).toBeTruthy();
  expect(screen.getByText('发布人：未记录')).toBeTruthy();
  expect(screen.getByText('变更摘要：初始演示计划')).toBeTruthy();
});
