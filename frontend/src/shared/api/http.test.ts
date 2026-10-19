import { describe, expect, it, vi } from 'vitest';
import { workflowStream } from './http';

describe('workflow progress transport failures', () => {
  it('rejects a truncated stream without inventing a final result or retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"type":"stage_started","action":"validate"}\n', {
        headers: { 'Content-Type': 'application/x-ndjson' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const progress = vi.fn();
    await expect(workflowStream({}, progress)).rejects.toThrow('未取得完整结果');
    expect(progress).toHaveBeenCalledWith({ type: 'stage_started', action: 'validate' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves snapshot conflict codes from streamed errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            '{"type":"error","status":409,"code":"snapshot_conflict","detail":"事件已更新"}\n',
            { headers: { 'Content-Type': 'application/x-ndjson' } },
          ),
        ),
    );
    await expect(workflowStream({}, vi.fn())).rejects.toMatchObject({
      status: 409,
      code: 'snapshot_conflict',
      message: '事件已更新',
    });
  });
});
