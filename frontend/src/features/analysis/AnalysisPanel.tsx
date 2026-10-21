import type { WorkflowResult } from '../../shared/api/contracts';
import { WorkflowNotices, WorkflowStatements } from '../../shared/ui/WorkflowEvidence';
import { Accordion } from '../../shared/ui/Accordion';
import { KnowledgePanel } from '../../shared/ui/KnowledgePanel';

interface Props {
  busy: string;
  question: string;
  result: WorkflowResult;
  onQuestion: (value: string) => void;
  onExplain: () => void;
}

export function AnalysisPanel({ busy, question, result, onQuestion, onExplain }: Props) {
  const report = result.results.explanation;
  const data = report?.data;
  const execution = result.trace.find((step) => step.action === 'explain')?.execution;
  return (
    <section id="fault-analysis" tabIndex={-1} className="section ai-section" aria-label="辅助分析">
      <div className="section-heading">
        <div>
          <p className="eyebrow">COPILOT ASSIST</p>
          <h2 id="section-analysis">辅助分析</h2>
        </div>
        <span className="tag">本次结果解释 · 人工决定是否发布</span>
      </div>
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
      <KnowledgePanel report={result.trace.find((step) => step.action === 'explain')?.knowledge} />
      {data ? (
        <>
          <p className="explanation-summary">
            <strong>{data.summary}</strong>
          </p>
          <h3 id="section-facts" className="block-title">
            事实、假设与风险
          </h3>
          <div className="explanation-grid">
            <WorkflowStatements result={result} title="事实" items={data.facts?.slice(0, 1)} />
            <WorkflowStatements
              result={result}
              title="假设"
              items={data.assumptions?.slice(0, 1)}
            />
            <WorkflowStatements result={result} title="风险" items={data.risks?.slice(0, 1)} />
          </div>
          <h3 id="section-advice" className="block-title">
            取舍与建议
          </h3>
          <div className="explanation-grid">
            <WorkflowStatements result={result} title="取舍" items={data.tradeoffs?.slice(0, 1)} />
            {!!data.next_steps?.length && (
              <div className="explanation-group">
                <h3>下一步</h3>
                <ul>
                  {data.next_steps.map((step, i) => (
                    <li key={i}>
                      <strong>{step.action}</strong>
                      {step.requires_human_confirmation && '（需人工确认）'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <Accordion title="风险、假设与完整分析明细">
            <WorkflowStatements result={result} title="更多事实" items={data.facts?.slice(1)} />
            <WorkflowStatements
              result={result}
              title="更多假设"
              items={data.assumptions?.slice(1)}
            />
            <WorkflowStatements result={result} title="更多风险" items={data.risks?.slice(1)} />
            <WorkflowStatements result={result} title="更多取舍" items={data.tradeoffs?.slice(1)} />
            {!!data.limitations?.length && (
              <div className="explanation-group">
                <h3>限制</h3>
                <ul>
                  {data.limitations.map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ul>
              </div>
            )}
          </Accordion>
        </>
      ) : (
        <p className="empty-state">
          {result.intent === 're_evaluate' && result.status === 'completed'
            ? '评估已更新，可点击“重新解释”查看最新说明。'
            : '暂无可用解释。可查看执行详情中的问题，或基于已有结果重新解释。'}
        </p>
      )}
      <details className="explanation-question">
        <summary>针对已有结果提问</summary>
        <fieldset disabled={!!busy}>
          <label>
            解释问题
            <textarea
              value={question}
              maxLength={2000}
              onChange={(e) => onQuestion(e.target.value)}
            />
          </label>
          <button disabled={!question.trim()} onClick={onExplain}>
            重新解释
          </button>
        </fieldset>
      </details>
    </section>
  );
}
