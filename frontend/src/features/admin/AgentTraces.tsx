import { useEffect, useState } from 'react';
import { workbenchApi } from '../workbench';
import type { DiagnosticPage, DiagnosticRun } from '../../shared/api/traces';
import { dateTime } from '../../shared/lib/time';
import { Modal } from '../../shared/ui/Modal';

const labels: Record<string, string> = {
  fault: '故障分析',
  insertion: '插单评估',
  completed: '已完成',
  failed: '失败',
  blocked: '已阻断',
  success: '成功',
  warning: '有提示',
  running: '执行中',
  rules: '规则',
  live: '模型辅助',
  fallback: '已降级',
  disabled: '未开启',
  not_configured: '未配置密钥',
  queued: '等待上传',
  uploaded: '已上传',
  queue_full: '上传队列已满',
  validation: '数据校验',
  scheduling: '排产执行',
  evaluation: '方案评估',
  explanation: '结果解释',
  saving: '保存结果',
  model_call: '模型调用',
  save_simulation: '保存候选',
  attach_simulation: '关联候选',
};
const label = (value: string) =>
  value.endsWith('_tool')
    ? `${labels[value.slice(0, -5)] || value.slice(0, -5)}工具`
    : labels[value] || value;
function safeLink(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function AgentTraces() {
  const [filters, setFilters] = useState({ kind: '', status: '', start: '', end: '', page: '1' });
  const [result, setResult] = useState<DiagnosticPage | null>(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<DiagnosticRun | null>(null);
  const [detailError, setDetailError] = useState('');
  const [selection, setSelection] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setResult(null);
    workbenchApi
      .adminTraces(filters)
      .then((value) => {
        if (active) setResult(value);
      })
      .catch(() => {
        if (active) setError('运行追踪读取失败，请重试或重新登录。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filters, reload]);
  useEffect(() => {
    if (!selection) return;
    let active = true;
    setSelected(null);
    setDetailError('');
    workbenchApi
      .adminTrace(selection)
      .then((value) => {
        if (active) setSelected(value);
      })
      .catch(() => {
        if (active) setDetailError('追踪详情读取失败，请关闭后重试。');
      });
    return () => {
      active = false;
    };
  }, [selection]);
  const change = (key: string, value: string) =>
    setFilters((previous) => ({ ...previous, [key]: value, page: '1' }));
  const link = safeLink(selected?.langsmith_url);
  return (
    <section className="admin-panel agent-traces" aria-label="Agent 运行追踪">
      <header>
        <h2>Agent 运行追踪</h2>
        <button disabled={loading} onClick={() => setReload((value) => value + 1)}>
          刷新追踪
        </button>
      </header>
      <div className="inline-actions">
        <label>
          业务类型
          <select value={filters.kind} onChange={(e) => change('kind', e.target.value)}>
            <option value="">全部</option>
            <option value="fault">故障分析</option>
            <option value="insertion">插单评估</option>
          </select>
        </label>
        <label>
          运行状态
          <select value={filters.status} onChange={(e) => change('status', e.target.value)}>
            <option value="">全部</option>
            <option value="completed">已完成</option>
            <option value="failed">失败</option>
            <option value="blocked">已阻断</option>
          </select>
        </label>
        <label>
          开始日期
          <input
            type="date"
            value={filters.start}
            onChange={(e) => change('start', e.target.value)}
          />
        </label>
        <label>
          结束日期
          <input type="date" value={filters.end} onChange={(e) => change('end', e.target.value)} />
        </label>
      </div>
      <p>仅展示接入后的运行记录；旧记录未接入追踪。上传状态与业务结果分别记录。</p>
      {loading && <p role="status">正在读取运行追踪…</p>}
      {error && <p role="alert">{error}</p>}
      {result &&
        (result.items.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>时间（北京时间）</th>
                  <th>业务</th>
                  <th>编号</th>
                  <th>结果</th>
                  <th>模式</th>
                  <th>耗时</th>
                  <th>模型调用</th>
                  <th>Token 输入 / 输出</th>
                  <th>追踪上传</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((run) => (
                  <tr key={run.id}>
                    <td>{dateTime(run.started_at)}</td>
                    <td>{label(run.business_type)}</td>
                    <td>{run.business_id || '未记录'}</td>
                    <td>{label(run.status)}</td>
                    <td>{label(run.mode)}</td>
                    <td>{run.elapsed_ms} ms</td>
                    <td>{run.model_calls}</td>
                    <td>
                      {run.input_tokens ?? '未统计'} / {run.output_tokens ?? '未统计'}
                    </td>
                    <td>
                      {run.upload_status === 'failed' ? '上传失败' : label(run.upload_status)}
                    </td>
                    <td>
                      <button onClick={() => setSelection(run.id)}>查看追踪</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>当前筛选条件下暂无运行追踪。</p>
        ))}
      {result && (
        <nav aria-label="追踪分页">
          <button
            disabled={result.page <= 1}
            onClick={() => setFilters({ ...filters, page: String(result.page - 1) })}
          >
            上一页
          </button>
          <span>
            第 {result.page} 页 · 共 {result.total} 条
          </span>
          <button
            disabled={result.page * 20 >= result.total}
            onClick={() => setFilters({ ...filters, page: String(result.page + 1) })}
          >
            下一页
          </button>
        </nav>
      )}
      {selection && (
        <Modal drawer title="Agent 运行追踪详情" onClose={() => setSelection(null)}>
          {detailError ? (
            <p role="alert">{detailError}</p>
          ) : !selected ? (
            <p role="status">正在读取详情…</p>
          ) : (
            <>
              <p>
                {selected.business_id} · {label(selected.status)} · {label(selected.mode)}
              </p>
              <p>运行 ID：{selected.id}</p>
              <p>本地 Trace：{selected.local_trace_id || '未记录'}</p>
              <p>工作流：{selected.workflow_id || '不适用'}</p>
              {selected.business_type === 'insertion' && (
                <p>插单评估编号：{selected.assessment_id || '未记录'}</p>
              )}
              <p>
                计划版本：{selected.plan_version ?? '未记录'}；事件修订：
                {selected.event_revision ?? '未记录'}
              </p>
              <p>输入指纹：{selected.input_fingerprint || '未记录'}</p>
              <p>
                追踪上传：
                {selected.upload_status === 'failed'
                  ? '上传失败'
                  : label(selected.upload_status)}{' '}
                {selected.upload_error}
              </p>
              {selected.error_code && <p>失败类别：{selected.error_code}</p>}
              {link && (
                <a href={link} target="_blank" rel="noopener noreferrer">
                  在 LangSmith 查看（需登录）
                </a>
              )}
              <ol aria-label="执行节点">
                {[...selected.spans]
                  .sort((a, b) => a.started_at.localeCompare(b.started_at))
                  .map((node) => (
                    <li key={node.id}>
                      {node.parent_id ? '↳ ' : ''}
                      {label(node.name)} · {label(node.status)} · {node.elapsed_ms} ms{' '}
                      {node.mode && `· ${label(node.mode)}`}{' '}
                      {node.error_code && `· ${node.error_code}`}
                      {!!node.corrections && ` · 格式修复 ${node.corrections} 次`}
                      {node.failure_phase && ` · 失败阶段：${node.failure_phase}`}
                      {node.model && (
                        <span>
                          {' '}
                          · {node.model} · Token {node.input_tokens ?? '未统计'} /{' '}
                          {node.output_tokens ?? '未统计'}
                        </span>
                      )}
                    </li>
                  ))}
              </ol>
            </>
          )}
        </Modal>
      )}
    </section>
  );
}
