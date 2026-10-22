import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { PlanVersionTag } from './PlanVersionTag';

it('shows saved publication metadata in a drawer and supports close', async () => {
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
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.click(button);
  expect(screen.getByText('发布时间：2026-10-20 14:41')).toBeTruthy();
  expect(screen.getByText('发布人：planner_01')).toBeTruthy();
  expect(screen.getByText(/变更摘要：发布插单申请 URG-20261020-001/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.click(button);
  expect(screen.getByRole('dialog', { name: '计划版本历史' })).toBeTruthy();
});

it('does not invent publication details for the initial plan', async () => {
  render(<PlanVersionTag version={1} />);
  await userEvent.click(screen.getByRole('button'));
  expect(screen.getByText('发布时间：未记录')).toBeTruthy();
  expect(screen.getByText('发布人：未记录')).toBeTruthy();
  expect(screen.getByText('变更摘要：初始演示计划')).toBeTruthy();
});

it('sorts versions newest first and expands historical text without changing the plan', async () => {
  const user = userEvent.setup();
  render(
    <PlanVersionTag
      version={4}
      publication={{
        version: 4,
        published_at: null,
        published_by: 'planner_01',
        version_summary: '故障调整',
        history: [
          {
            version: 3,
            published_at: null,
            published_by: null,
            version_summary: '原计划',
            details: ['调整 O1002-OP2 工序时间'],
          },
          {
            version: 4,
            published_at: null,
            published_by: 'planner_01',
            version_summary: '故障调整',
            details: ['M3 故障调整排产'],
          },
        ],
      }}
    />,
  );
  await user.click(screen.getByRole('button'));
  const rows = screen.getByRole('list', { name: '计划版本时间轴' }).querySelectorAll('details');
  expect(rows[0].textContent).toContain('V4');
  expect(rows[0].open).toBe(true);
  expect(rows[1].open).toBe(false);
  await user.click(rows[1].querySelector('summary')!);
  expect(rows[1].open).toBe(true);
  expect(screen.getByText('调整 O1002-OP2 工序时间')).toBeTruthy();
  expect(screen.getByText('当前执行版')).toBeTruthy();
  expect(screen.getByText('历史修订')).toBeTruthy();
});
