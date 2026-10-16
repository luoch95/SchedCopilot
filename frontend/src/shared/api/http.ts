import { ApiError } from './errors';

export async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      `/api${path}`,
      body === undefined
        ? { method: 'GET' }
        : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
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
