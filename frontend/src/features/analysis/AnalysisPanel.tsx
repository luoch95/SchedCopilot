import ReactMarkdown from 'react-markdown';
import type { CopilotAnswer, WorkflowResult } from '../../shared/api/contracts';
import { WorkflowNotices, WorkflowStatements } from '../../shared/ui/WorkflowEvidence';
import { DetailSurface } from '../../shared/ui/DetailSurface';
import { KnowledgePanel } from '../../shared/ui/KnowledgePanel';
import { useBusinessText } from '../../shared/lib/BusinessLabelProvider';

interface Props {
  busy: string;
  question: string;
  result: WorkflowResult;
  onQuestion: (value: string) => void;
  onExplain: () => void;
  answer?: CopilotAnswer | null;
  asking?: boolean;
  askError?: string;
  disabled?: boolean;
  showSummary?: boolean;
  readOnly?: boolean;
  view?: 'full' | 'conclusions' | 'question';
}

export function AnalysisPanel({
  busy,
  question,
  result,
  onQuestion,
  onExplain,
  answer,
  asking = false,
  askError,
  disabled = false,
  showSummary = true,
  readOnly = false,
  view = 'full',
}: Props) {
  const format = useBusinessText();
  const report = result.results.explanation;
  const data = report?.data;
  const execution = result.trace.find((step) => step.action === 'explain')?.execution;
  return (
    <section
      id={view === 'full' ? 'fault-analysis' : undefined}
      tabIndex={-1}
      className="section ai-section copilot-assist"
      aria-label={view === 'question' ? '方案问答' : '辅助分析'}
    >
      {view !== 'question' && (
        <>
          {view === 'full' && (
            <div className="section-heading">
              <div>
                <p className="eyebrow">COPILOT ASSIST</p>
                <h2 id="section-analysis">✨ Copilot 智能辅助分析</h2>
              </div>
              <span className="tag">
                {result.results.evaluation?.data?.assessment
                  ? '本次评估结论 · 人工审批'
                  : '本次结果解释 · 人工决定是否发布'}
              </span>
            </div>
          )}
          <p className="hint">
            {execution?.mode === 'live'
              ? '模型根据你的问题选择分析重点；事实、指标和风险来自已校验的后台证据。'
              : execution?.mode === 'fallback'
                ? '本次模型解释未完成，以下使用规则与证据模板说明。'
                : '解释本次校验和候选方案的证据；当前说明由规则与证据模板生成。'}
          </p>
          {execution?.mode === 'live' && (
            <WorkflowStatements result={result} title="本次分析重点" items={execution.highlights} />
          )}
          {report && (
            <WorkflowNotices result={result} notices={[...report.errors, ...report.warnings]} />
          )}
          <KnowledgePanel
            report={result.trace.find((step) => step.action === 'explain')?.knowledge}
          />
          {data ? (
            <>
              {showSummary && (
                <p className="explanation-summary">
                  <strong>{format(data.summary ?? '')}</strong>
                </p>
              )}
              <section
                className={view === 'conclusions' ? 'decision-analysis-card' : undefined}
                aria-labelledby="section-facts"
              >
                <h3 id="section-facts" className="block-title">
                  {view === 'conclusions' ? '4.1 事实/假设与风险' : '事实、假设与风险'}
                </h3>
                <div className="explanation-grid">
                  <WorkflowStatements
                    result={result}
                    title="事实"
                    items={data.facts?.slice(0, 1)}
                  />
                  <WorkflowStatements
                    result={result}
                    title="假设"
                    items={data.assumptions?.slice(0, 1)}
                  />
                  <WorkflowStatements
                    result={result}
                    title="风险"
                    items={data.risks?.slice(0, 1)}
                  />
                </div>
              </section>
              <section
                className={view === 'conclusions' ? 'decision-analysis-card' : undefined}
                aria-labelledby="section-advice"
              >
                <h3 id="section-advice" className="block-title">
                  {view === 'conclusions' ? '4.2 取舍与建议' : '取舍与建议'}
                </h3>
                <div className="explanation-grid">
                  <WorkflowStatements
                    result={result}
                    title="取舍"
                    items={data.tradeoffs?.slice(0, 1)}
                  />
                  {!!data.next_steps?.length && (
                    <div className="explanation-group">
                      <h3>下一步</h3>
                      <ul>
                        {data.next_steps.map((step, i) => (
                          <li key={i}>
                            <strong>{format(step.action)}</strong>
                            {step.requires_human_confirmation && '（需人工确认）'}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </section>
              <DetailSurface
                flat={view === 'conclusions'}
                className={view === 'conclusions' ? 'decision-analysis-card' : 'decision-accordion'}
                title={
                  <h3 id="section-analysis-detail">
                    {view === 'conclusions' ? '4.3 风险与完整分析明细' : '风险、假设与完整分析明细'}
                  </h3>
                }
              >
                <WorkflowStatements result={result} title="更多事实" items={data.facts?.slice(1)} />
                <WorkflowStatements
                  result={result}
                  title="更多假设"
                  items={data.assumptions?.slice(1)}
                />
                <WorkflowStatements result={result} title="更多风险" items={data.risks?.slice(1)} />
                <WorkflowStatements
                  result={result}
                  title="更多取舍"
                  items={data.tradeoffs?.slice(1)}
                />
                {!!data.limitations?.length && (
                  <div className="explanation-group">
                    <h3>限制</h3>
                    <ul>
                      {data.limitations.map((text, i) => (
                        <li key={i}>{format(text)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </DetailSurface>
            </>
          ) : (
            <p className="empty-state">
              {result.intent === 're_evaluate' && result.status === 'completed'
                ? '评估已更新，可通过下方问答了解最新结果。'
                : '暂无完整解释。可查看执行详情，或针对已有结果提问。'}
            </p>
          )}
        </>
      )}
      {!readOnly && view !== 'conclusions' && (
        <div className="copilot-conversation">
          <p className="hint">针对已有结果提问，了解交期、转移与风险。解答不会重新生成方案。</p>
          <fieldset disabled={!!busy || asking || disabled}>
            <label htmlFor="copilot-question">解释问题</label>
            <textarea
              id="copilot-question"
              value={question}
              maxLength={2000}
              rows={4}
              placeholder="询问当前方案的延期影响、设备转移或决策依据…"
              onChange={(e) => onQuestion(e.target.value)}
            />
            <div className="copilot-prompts" aria-label="快捷提问">
              {[
                '这方案的延期代价能接受吗？',
                '如果不转移会怎样？',
                '这份方案有哪些风险需要人工确认？',
              ].map((prompt) => (
                <button type="button" key={prompt} onClick={() => onQuestion(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
            <div className="copilot-submit-row">
              <span>基于当前结果 · 不修改计划</span>
              <button
                type="button"
                className="primary"
                disabled={!question.trim()}
                onClick={onExplain}
              >
                {asking ? '正在获取 AI 解答…' : '✨ 获取 AI 解答'}
              </button>
            </div>
          </fieldset>
          <div aria-live="polite" aria-busy={asking}>
            {asking && (
              <p role="status" className="copilot-answer-status">
                正在查阅当前方案与知识依据…
              </p>
            )}
            {askError && (
              <p role="alert" className="message error">
                {askError}
              </p>
            )}
            {answer && (
              <section className="copilot-answer" aria-label="AI 解答">
                <header>
                  <strong>✨ Copilot 解答</strong>
                  <span>
                    {answer.mode === 'live' ? 'AI 辅助 · 证据回答' : '规则依据 · 模型解答不可用'}
                  </span>
                </header>
                <p className="hint">你的问题：{answer.question}</p>
                <div className="copilot-markdown">
                  <ReactMarkdown
                    skipHtml
                    components={
                      view === 'question'
                        ? {
                            h1: ({ children }) => <h4>{children}</h4>,
                            h2: ({ children }) => <h4>{children}</h4>,
                            h3: ({ children }) => <h4>{children}</h4>,
                          }
                        : undefined
                    }
                  >
                    {format(answer.answer)}
                  </ReactMarkdown>
                </div>
                <p className="hint">{answer.knowledge.message}</p>
                {answer.knowledge.sources.length > 0 && (
                  <DetailSurface flat={view === 'question'} title="查看参考资料 · 模拟演示资料">
                    {answer.knowledge.sources.map((source) => (
                      <blockquote key={source.chunk_id}>
                        <strong>
                          {source.title} · {source.section}
                        </strong>
                        <p>{source.excerpt}</p>
                      </blockquote>
                    ))}
                  </DetailSurface>
                )}
              </section>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
