import { useId, useRef } from 'react';
import type {
  WorkflowIntent,
  WorkflowResult,
  WorkflowProgress,
  WorkflowReport,
} from '../../shared/api/contracts';
import { WaitingResult } from '../../shared/ui/WaitingResult';
import {
  WorkflowDebugDetails,
  WorkflowNotices,
  WorkflowStatements,
} from '../../shared/ui/WorkflowEvidence';

interface Props {
  running: boolean;
  disabled: boolean;
  result: WorkflowResult | null;
  progress?: WorkflowProgress | null;
  onRun: (intent: WorkflowIntent) => void;
}

const stages = [
  { action: 'validate', name: 'validation', label: '数据校验' },
  { action: 'schedule', name: 'scheduling', label: '排产执行' },
  { action: 'evaluate', name: 'evaluation', label: '方案评估' },
  { action: 'explain', name: 'explanation', label: '结果解释' },
] as const;
const labels: Record<string, string> = {
  success: '通过',
  warning: '有警告',
  blocked: '已阻断',
  failed: '失败',
  completed: '已完成',
};
const modelErrors: Record<string, string> = {
  MODEL_TIMEOUT: '模型请求超时',
  MODEL_AUTH_FAILED: '模型服务鉴权失败',
  MODEL_RATE_LIMITED: '模型服务请求受限',
  MODEL_API_ERROR: '模型服务接口报错',
  MODEL_NOT_CONFIGURED: '模型尚未配置',
  MODEL_OUTPUT_INVALID: '模型返回内容未通过校验',
  MODEL_UNAVAILABLE: '模型服务连接失败',
  AGENT_TOOL_FAILED: '业务工具执行失败',
};
const ruleResults: Record<string, string> = {
  validation: '规则校验已完成',
  scheduling: '规则排产已完成',
  evaluation: '规则评估已完成',
  explanation: '模板解释已完成',
};

function stageSummary(name: string, report?: WorkflowReport) {
  if (!report) return '查看执行记录';
  if (report.status === 'blocked' || report.status === 'failed') return '查看原因与处理建议';
  if (name === 'scheduling' && report.data?.candidates)
    return `已生成 ${report.data.candidates.length} 个候选方案`;
  if (name === 'evaluation' && report.data?.evaluations)
    return `已评估 ${report.data.evaluations.length} 个候选方案`;
  if (name === 'explanation') return '已生成结果解释，查看结论与建议';
  if (name !== 'validation') return '本环节已完成，查看结果与提示';
  return report.warnings.length
    ? `校验完成，${report.warnings.length} 项提示待查看`
    : '数据校验已完成';
}

export function WorkflowPanel({ running, disabled, result: finalResult, progress, onRun }: Props) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const detailRefs = useRef<Record<string, HTMLElement | null>>({});
  const detailId = useId();
  const partial = progress && (running || progress.interrupted);
  const result: WorkflowResult | null = partial
    ? {
        id: '',
        intent: progress.intent,
        status: 'failed',
        failure_code: null,
        trace: progress.trace,
        results: progress.results,
        evidence_catalog: {},
      }
    : finalResult;
  const intent = progress?.intent ?? result?.intent;
  const planned =
    progress?.actions ??
    (intent
      ? {
          generate_candidates: ['validate', 'schedule', 'evaluate', 'explain'],
          validate: ['validate'],
          re_evaluate: ['evaluate'],
          explain: ['explain'],
        }[intent]
      : stages.map((stage) => stage.action));
  const visibleStages = stages.filter((stage) => planned.includes(stage.action));
  function showDetails(name: string) {
    if (detailsRef.current) detailsRef.current.open = true;
    const target = detailRefs.current[name];
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
  }
  const executions = stages.flatMap((stage) => {
    const step = result?.trace.find((item) => item.action === stage.action);
    return step ? [{ ...stage, step }] : [];
  });
  const fallback = executions.filter(({ step }) => step.execution?.mode === 'fallback');
  const modelCompleted = executions.filter(({ step }) => step.execution?.mode === 'live');
  const modelCount = executions.filter(({ step }) => step.execution).length;
  const completed = executions.filter(({ step }) => ['success', 'warning'].includes(step.status));
  return (
    <section className="workflow-progress" aria-label="四 Agent 执行状态" aria-busy={running}>
      <div className="workflow-caption">
        <h2>本次 Agent 链路</h2>
        <span role="status">
          {running ? (
            <WaitingResult />
          ) : progress?.interrupted ? (
            '执行进度已中断'
          ) : result ? (
            `工作流：${labels[result.status]}`
          ) : (
            '生成候选方案后，按以下流程执行'
          )}
        </span>
      </div>
      <ol
        className="workflow-stages"
        aria-label="Agent 执行顺序"
        style={{ '--stage-count': visibleStages.length } as React.CSSProperties}
      >
        {visibleStages.map((stage, index) => {
          const report = result?.results[stage.name];
          const execution = result?.trace.find((step) => step.action === stage.action);
          const status =
            execution?.status ??
            (partial ? undefined : report?.status) ??
            (running && progress?.active === stage.action ? 'running' : 'pending');
          const wasSkipped =
            running &&
            !!progress?.active &&
            planned.indexOf(stage.action) < planned.indexOf(progress.active) &&
            !execution;
          const isStopped = progress?.interrupted && status === 'pending';
          const pendingText = isStopped
            ? '状态未确认'
            : wasSkipped || (result && !running)
              ? '未执行（前序阻断或失败）'
              : index === 0
                ? '等待后台开始'
                : '等待前序环节';
          return (
            <li
              key={stage.name}
              data-status={wasSkipped ? 'skipped' : status}
              aria-current={status === 'running' ? 'step' : undefined}
            >
              <span className="workflow-node-title">
                <span className="workflow-node-marker" aria-hidden="true">
                  {['success', 'warning'].includes(status)
                    ? '✓'
                    : status === 'blocked' || status === 'failed'
                      ? '!'
                      : index + 1}
                </span>
                {stage.label} Agent
              </span>
              <small>
                {status === 'running'
                  ? '执行中'
                  : status !== 'pending'
                    ? labels[status]
                    : intent
                      ? pendingText
                      : '待执行'}
              </small>
              {execution && (
                <p className="workflow-node-summary">{stageSummary(stage.name, report)}</p>
              )}
              {execution?.execution && (
                <small>{execution.execution.mode === 'live' ? '模型辅助' : '规则回退'}</small>
              )}
              {execution && (
                <button
                  className="workflow-node-link"
                  onClick={() => showDetails(stage.name)}
                  aria-controls={`${detailId}-${stage.name}`}
                  aria-label={`查看${stage.label}详情`}
                >
                  查看详情 →
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {running && (
        <p className="hint" role="status">
          已完成 {completed.length}/{visibleStages.length} 个环节；
          {progress?.active
            ? `正在执行${stages.find((stage) => stage.action === progress.active)?.label} Agent。`
            : '等待后台更新进度。'}
          已完成的节点可查看详情，整条链路结束后展示可用方案。
        </p>
      )}
      {progress?.interrupted && (
        <p className="message warning">
          进度连接或请求已中断。已收到的节点结果保留，其余状态未确认；请检查后台后重新生成方案。
        </p>
      )}
      {result && !running && (
        <p className="hint">
          本次已完成 {completed.length}/{executions.length} 个 Agent 环节
          {completed.length > 0 &&
            `：${completed.map((stage) => `${stage.label} Agent`).join('、')}`}
          。
          {executions.some(({ step }) => step.status === 'blocked') &&
            '阻断环节已标注，后续依赖环节未执行。'}
        </p>
      )}
      {!!fallback.length && !running && (
        <div className="message warning" aria-label="模型辅助执行情况">
          <p>
            模型辅助已完成 {modelCompleted.length}/{modelCount} 个 Agent
            {modelCompleted.length > 0 &&
              `：${modelCompleted.map((stage) => `${stage.label} Agent`).join('、')}`}
            。
          </p>
          <ul>
            {fallback.map(({ name, label, step }) => (
              <li key={name}>
                <strong>{label} Agent：模型辅助未完成</strong>（
                {modelErrors[step.execution?.error_code ?? ''] ?? '模型辅助执行异常'}）；
                {step.status === 'failed'
                  ? '该环节执行失败，未得到可用结果。'
                  : step.status === 'blocked'
                    ? '规则检查已阻断后续执行，请先处理阻断项。'
                    : `${ruleResults[name]}，本环节使用规则结果。`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result?.failure_code && (
        <p className="message error">执行失败：{result.failure_code}。请重新生成方案。</p>
      )}
      <details className="workflow-details" ref={detailsRef}>
        <summary>
          <h3>执行详情</h3>
        </summary>
        <p className="hint">查看各环节的问题与处理建议。辅助操作使用已保存的数据。</p>
        <p className="hint">重新校验会清除本次候选；生成方案时会自动校验。</p>
        <div className="inline-actions">
          <button disabled={disabled} onClick={() => onRun('validate')}>
            仅校验数据
          </button>
          <button
            disabled={disabled || !result?.results.scheduling?.data}
            onClick={() => onRun('re_evaluate')}
          >
            重新评估已有方案
          </button>
        </div>
        {result && (
          <div className="workflow-detail-list">
            {stages.map((stage) => {
              const report = result.results[stage.name];
              const execution = result.trace.find(
                (step) => step.action === stage.action,
              )?.execution;
              const step = result.trace.find((item) => item.action === stage.action);
              if (!report && !step) return null;
              return (
                <article
                  key={stage.name}
                  id={`${detailId}-${stage.name}`}
                  tabIndex={-1}
                  ref={(element) => {
                    detailRefs.current[stage.name] = element;
                  }}
                >
                  <header className="workflow-agent-heading">
                    <h4>{stage.label}</h4>
                    <span
                      className="workflow-agent-status"
                      data-status={step?.status ?? report?.status ?? 'failed'}
                    >
                      {labels[step?.status ?? report?.status ?? 'failed']}
                    </span>
                  </header>
                  <p>{stageSummary(stage.name, report)}</p>
                  {!report && (
                    <p className="hint">
                      {step?.error_code
                        ? `执行异常：${step.error_code}。`
                        : '该环节未返回详细报告。'}
                    </p>
                  )}
                  {!!(report?.errors.length || report?.warnings.length) && (
                    <section className="workflow-agent-notices">
                      <h5>问题与建议</h5>
                      <WorkflowNotices
                        result={result}
                        notices={[...(report?.errors ?? []), ...(report?.warnings ?? [])]}
                      />
                    </section>
                  )}
                  {execution?.mode === 'live' && (
                    <WorkflowStatements
                      result={result}
                      title="模型分析重点"
                      headingLevel={5}
                      items={execution.highlights}
                    />
                  )}
                </article>
              );
            })}
            <details>
              <summary>
                <h4>调用记录</h4>
              </summary>
              <ol>
                {result.trace.map((step, i) => (
                  <li key={i}>
                    {stages.find((stage) => stage.action === step.action)?.label ?? step.action}：
                    {labels[step.status] ?? step.status}
                    {step.error_code && ` · ${step.error_code}`}
                    {step.execution && (
                      <span>
                        {' · '}
                        {step.execution.mode === 'live' ? '模型辅助' : '规则回退'}
                        {step.execution.model && ` · ${step.execution.model}`}
                        {` · ${step.execution.calls} 次请求 · ${(step.execution.elapsed_ms / 1000).toFixed(1)} 秒`}
                        {` · 已返回输入/输出 Token：${step.execution.input_tokens ?? '未提供'}/${step.execution.output_tokens ?? '未提供'}`}
                        {step.execution.error_code && ` · ${step.execution.error_code}`}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </details>
            <WorkflowDebugDetails data={result} headingLevel={4} />
          </div>
        )}
      </details>
    </section>
  );
}
