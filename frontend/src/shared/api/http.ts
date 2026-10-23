import { ApiError } from './errors';
import type { WorkflowProgressEvent, WorkflowResponse } from './contracts';

export async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      `/api${path}`,
      body === undefined
        ? { method: 'GET', cache: 'no-store' }
        : {
            method,
            headers: { 'Content-Type': 'application/json', 'X-Demo-Write': '1' },
            body: JSON.stringify(body),
          },
    );
  } catch {
    throw new ApiError('无法连接后端。请确认 FastAPI 已在 8000 端口启动。', 0);
  }
  const data = await response.json();
  if (!response.ok) {
    const detail = data.detail;
    throw new ApiError(
      typeof detail === 'string' ? detail : '输入格式无效，请检查时间、来源和必填项。',
      response.status,
      data.code,
    );
  }
  return data as T;
}

/** Consume real progress without retrying a potentially still-running workflow. */
export async function workflowStream(
  body: unknown,
  onProgress: (event: WorkflowProgressEvent) => void,
  signal?: AbortSignal,
): Promise<WorkflowResponse> {
  let response: Response;
  try {
    response = await fetch('/api/workflow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
        'X-Demo-Write': '1',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    signal?.throwIfAborted();
    throw new ApiError('无法连接后端。请确认 FastAPI 已在 8000 端口启动。', 0);
  }
  if (!response.ok) {
    const data = await response.json();
    throw new ApiError(data.detail ?? '工作流请求失败。', response.status, data.code);
  }
  // Retain compatibility with servers returning the original one-shot response.
  if (!response.headers.get('content-type')?.includes('application/x-ndjson'))
    return response.json() as Promise<WorkflowResponse>;
  if (!response.body) throw new ApiError('无法读取执行进度，请重新生成方案。', 0);
  const reader = response.body.getReader();
  const cancelReader = () => void reader.cancel().catch(() => {});
  signal?.addEventListener('abort', cancelReader, { once: true });
  const decoder = new TextDecoder();
  let buffer = '';
  let result: WorkflowResponse | undefined;
  function consume(line: string) {
    signal?.throwIfAborted();
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'result') result = event.data;
    else if (event.type === 'error') throw new ApiError(event.detail, event.status, event.code);
    else if (event.type !== 'heartbeat') onProgress(event as WorkflowProgressEvent);
  }
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) consume(line);
      if (done) break;
    }
    consume(buffer);
    signal?.throwIfAborted();
    if (!result)
      throw new ApiError('执行进度连接中断，未取得完整结果。请检查后台后重新生成方案。', 0);
    return result;
  } finally {
    signal?.removeEventListener('abort', cancelReader);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
