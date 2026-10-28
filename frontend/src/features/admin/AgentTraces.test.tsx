import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AgentTraces } from './AgentTraces';
import { workbenchApi } from '../workbench';
import type { DiagnosticRun } from '../../shared/api/traces';

vi.mock('../workbench', () => ({ workbenchApi: { adminTraces: vi.fn(), adminTrace: vi.fn() } }));

const run: DiagnosticRun = {
  id: 'run-1',
  business_type: 'insertion',
  business_id: 'URG-TEST-1',
  started_at: '2026-10-28T08:30:00+00:00',
  ended_at: '2026-10-28T08:30:01+00:00',
  status: 'completed',
  mode: 'fallback',
  elapsed_ms: 1000,
  model_calls: 1,
  input_tokens: null,
  output_tokens: null,
  upload_status: 'failed',
  upload_error: 'LANGSMITH_UPLOAD_FAILED',
  spans: [
    {
      id: 'span-1',
      name: 'validation',
      kind: 'chain',
      parent_id: null,
      started_at: '2026-10-28T08:30:00+00:00',
      ended_at: '2026-10-28T08:30:01+00:00',
      status: 'success',
      mode: 'fallback',
      elapsed_ms: 1000,
      error_code: 'MODEL_TIMEOUT',
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(workbenchApi.adminTraces).mockResolvedValue({ items: [run], total: 1, page: 1 });
  vi.mocked(workbenchApi.adminTrace).mockResolvedValue(run);
});

it('shows business success separately from export failure and renders sanitized node details', async () => {
  render(<AgentTraces />);
  await screen.findByText('URG-TEST-1');
  expect(screen.getByText('2026-10-28 16:30')).toBeTruthy();
  expect(screen.getByRole('cell', { name: '已完成' })).toBeTruthy();
  expect(screen.getByText('上传失败')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '查看追踪' }));
  const drawer = screen.getByRole('dialog', { name: 'Agent 运行追踪详情' });
  await within(drawer).findByText(/MODEL_TIMEOUT/);
  expect(within(drawer).getByRole('list', { name: '执行节点' }).textContent).toContain('数据校验');
  expect(within(drawer).queryByRole('link')).toBeNull();
});

it('combines filters and resets pagination before refreshing', async () => {
  render(<AgentTraces />);
  await screen.findByText('URG-TEST-1');
  fireEvent.change(screen.getByLabelText('业务类型'), { target: { value: 'insertion' } });
  fireEvent.change(screen.getByLabelText('运行状态'), { target: { value: 'failed' } });
  fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-28' } });
  await waitFor(() =>
    expect(workbenchApi.adminTraces).toHaveBeenLastCalledWith({
      kind: 'insertion',
      status: 'failed',
      start: '2026-10-28',
      end: '',
      page: '1',
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '刷新追踪' })).toHaveProperty('disabled', false),
  );
  const calls = vi.mocked(workbenchApi.adminTraces).mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: '刷新追踪' }));
  await waitFor(() => expect(workbenchApi.adminTraces).toHaveBeenCalledTimes(calls + 1));
});

it.each(['javascript:alert(1)', 'http://example.com/run'])(
  'does not render unsafe trace link %s',
  async (url) => {
    vi.mocked(workbenchApi.adminTrace).mockResolvedValue({ ...run, langsmith_url: url });
    render(<AgentTraces />);
    fireEvent.click(await screen.findByRole('button', { name: '查看追踪' }));
    await screen.findByText('运行 ID：run-1');
    expect(screen.queryByRole('link')).toBeNull();
  },
);

it('shows a private HTTPS LangSmith link and handles read failures', async () => {
  vi.mocked(workbenchApi.adminTrace).mockResolvedValue({
    ...run,
    upload_status: 'uploaded',
    langsmith_url: 'https://smith.langchain.com/private-run',
  });
  const view = render(<AgentTraces />);
  fireEvent.click(await screen.findByRole('button', { name: '查看追踪' }));
  expect(await screen.findByRole('link', { name: '在 LangSmith 查看（需登录）' })).toHaveProperty(
    'href',
    'https://smith.langchain.com/private-run',
  );
  view.unmount();
  vi.mocked(workbenchApi.adminTraces).mockRejectedValue(new Error('offline'));
  render(<AgentTraces />);
  expect((await screen.findByRole('alert')).textContent).toBe(
    '运行追踪读取失败，请重试或重新登录。',
  );
});
