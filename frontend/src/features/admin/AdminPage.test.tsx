import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AdminPage from './AdminPage';
import { WeeklyReportButton, weeklyMarkdown } from './WeeklyReportButton';
import { workbenchApi } from '../workbench';
import type { Metrics } from '../../shared/api/metrics';

vi.mock('../workbench', () => ({
  workbenchApi: {
    adminSession: vi.fn(),
    adminLogin: vi.fn(),
    adminLogout: vi.fn(),
    adminMetrics: vi.fn(),
    adminVisitors: vi.fn(),
    adminTraces: vi.fn(),
    adminTrace: vi.fn(),
    weeklyMetrics: vi.fn(),
  },
}));
const metrics: Metrics = {
  source: 'business_records',
  period: {
    start: '2026-10-19T00:00:00+08:00',
    end: '2026-10-23T12:00:00+08:00',
    timezone: 'Asia/Shanghai',
  },
  visits: { source: 'daily_ip_uv', roles_source: 'mock', total: 1284, roles: { sales: 31 } },
  ai: {
    generated: 2,
    adopted: 1,
    published: 0,
    failed: 1,
    degraded: 0,
    risk_interceptions: 3,
    adoption_rate: null,
  },
  capacity_saved_minutes: null,
  scenarios: { equipment_failure: 1, urgent_insertion: 0 },
  trend: [{ label: '10-19', generated: 0, published: 0 }],
  limitations: ['插单历史未纳入统计'],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(workbenchApi.adminTraces).mockResolvedValue({ items: [], total: 0, page: 1 });
});
it('loads metrics only after a server login and hides them on logout', async () => {
  vi.mocked(workbenchApi.adminSession).mockResolvedValue({ admin: false });
  vi.mocked(workbenchApi.adminLogin).mockResolvedValue({ admin: true });
  vi.mocked(workbenchApi.adminMetrics).mockResolvedValue(metrics);
  render(<AdminPage onSwitchRole={() => {}} />);
  await screen.findByRole('button', { name: '登录' });
  expect(workbenchApi.adminMetrics).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('演示密码'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));
  await screen.findByText('累计日访客 UV');
  expect(screen.getByText('采纳率 未统计')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '退出研发后台' }));
  await screen.findByRole('button', { name: '登录' });
  expect(screen.queryByText('累计日访客 UV')).toBeNull();
});
it('opens visitor details on demand and excludes the current IP', async () => {
  vi.mocked(workbenchApi.adminSession).mockResolvedValue({ admin: true });
  vi.mocked(workbenchApi.adminMetrics).mockResolvedValue(metrics);
  vi.mocked(workbenchApi.adminVisitors).mockResolvedValue({
    items: [{ visit_date: '2026-10-29', ip: '203.0.113.1', matches_current_ip: true }],
    total: 1,
    page: 1,
    page_size: 20,
    current_ip: '203.0.113.1',
  });
  render(<AdminPage onSwitchRole={() => {}} />);
  await screen.findByRole('button', { name: '查看访客明细' });
  expect(workbenchApi.adminVisitors).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '查看访客明细' }));
  await screen.findByText('与当前 IP 相同');
  expect(workbenchApi.adminVisitors).toHaveBeenLastCalledWith(1, false);
  vi.mocked(workbenchApi.adminVisitors).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 20,
    current_ip: '203.0.113.1',
  });
  fireEvent.click(screen.getByRole('checkbox', { name: '排除当前 IP' }));
  await screen.findByText('暂无符合条件的访问记录。');
  expect(workbenchApi.adminVisitors).toHaveBeenLastCalledWith(1, true);
});

it('reports unavailable capacity and uses actual risk and failure fields', () => {
  const text = weeklyMarkdown(metrics);
  expect(text).toContain('AI 拦截风险：3 次');
  expect(text).toContain('方案生成：2 批');
  expect(text).toContain('产能节省：未统计');
  expect(text).toContain('工作流失败：1 次');
  expect(text).toContain('插单历史未纳入统计');
});
it('does not download a report if the metrics request fails', async () => {
  vi.mocked(workbenchApi.weeklyMetrics).mockRejectedValue(new Error('unavailable'));
  render(<WeeklyReportButton />);
  fireEvent.click(screen.getByRole('button', { name: '导出运行周报' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '周报读取失败，请重试。');
});
