import type { KnowledgeReport } from '../api/contracts';

interface Execution {
  calls: number;
  elapsed_ms: number;
  input_tokens?: number | null;
  output_tokens?: number | null;
  mode?: string;
  model?: string | null;
}
interface Step {
  label: string;
  status: string;
  span_id?: string | null;
  elapsed_ms?: number | null;
  execution?: Execution | null;
  knowledge?: KnowledgeReport | null;
}
const statuses: Record<string, string> = {
  success: '已完成',
  warning: '需关注',
  blocked: '已阻断',
  failed: '失败',
};
function duration(ms?: number | null) {
  return ms == null ? '未记录耗时' : '耗时 ' + (ms / 1000).toFixed(2) + ' 秒';
}
function tokens(
  executions: (Execution | undefined | null)[],
  key: 'input_tokens' | 'output_tokens',
) {
  const calls = executions.filter((item): item is Execution => !!item && item.calls > 0);
  if (calls.some((item) => item[key] == null)) return '未完整提供';
  return calls.reduce((sum, item) => sum + (item[key] ?? 0), 0);
}
function usage(executions: (Execution | undefined | null)[]) {
  return (
    '输入/输出 Token：' +
    tokens(executions, 'input_tokens') +
    '/' +
    tokens(executions, 'output_tokens')
  );
}
export function TraceBadge({ traceId }: { traceId?: string }) {
  return traceId ? (
    <code className="trace-badge" title="本次分析的唯一追踪编号">
      {traceId}
    </code>
  ) : null;
}
export function TraceTree({ traceId, steps }: { traceId?: string; steps: Step[] }) {
  if (!steps.length) return null;
  return (
    <div className="trace-record" aria-label="分析追踪记录">
      <p className="trace-root">
        <strong>本次分析</strong> <TraceBadge traceId={traceId} />
      </p>
      <ol className="trace-tree">
        {steps.map((step, index) => (
          <li key={step.span_id ?? index}>
            <div className="trace-agent">
              <strong>{step.label} Agent</strong>
              <span>{statuses[step.status] ?? '状态待确认'}</span>
              <span>{duration(step.elapsed_ms ?? step.execution?.elapsed_ms)}</span>
              <span>
                {step.status === 'failed' && !step.execution
                  ? '输入/输出 Token：未记录'
                  : usage([step.execution, step.knowledge?.execution])}
              </span>
            </div>
            <ol>
              {step.execution ? (
                <li>
                  模型辅助执行汇总 · {step.execution.mode === 'live' ? '已完成' : '规则回退'}
                  {step.execution.model && ' · ' + step.execution.model}
                  {' · ' +
                    step.execution.calls +
                    ' 次请求 · ' +
                    duration(step.execution.elapsed_ms) +
                    ' · ' +
                    usage([step.execution])}
                  <small>角色执行耗时包含工具与校验；Token 不含下方知识整理调用。</small>
                </li>
              ) : step.status === 'failed' ? (
                <li>执行异常 · 模型调用及 Token 用量未记录</li>
              ) : (
                <li>规则工具执行 · 不调用角色模型 · 输入/输出 Token：0/0</li>
              )}
              {step.knowledge && (
                <li>
                  知识检索与依据整理 · {step.knowledge.sources.length} 条资料
                  {' · ' +
                    duration(step.knowledge.execution.elapsed_ms) +
                    ' · ' +
                    usage([step.knowledge.execution])}
                  {step.knowledge.execution.error_code && ' · 已回退检索原文'}
                </li>
              )}
            </ol>
          </li>
        ))}
      </ol>
      <p className="hint">父级为 Agent 总耗时，包含子步骤，不能累加；未返回的 Token 不记为零。</p>
    </div>
  );
}
