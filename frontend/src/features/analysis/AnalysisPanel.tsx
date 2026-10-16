interface Props {
  busy: string;
  blocked: boolean;
  question: string;
  live: boolean;
  reports: Record<string, string> | null;
  onQuestion: (value: string) => void;
  onLive: (value: boolean) => void;
  onAnalyze: () => void;
}
export function AnalysisPanel({
  busy,
  blocked,
  question,
  live,
  reports,
  onQuestion,
  onLive,
  onAnalyze,
}: Props) {
  return (
    <section className="section ai-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">COPILOT ASSIST</p>
          <h2>AI 辅助分析</h2>
        </div>
        <span className="tag">三个角色 · 只读证据 · 无发布权限</span>
      </div>
      <fieldset disabled={!!busy}>
        <label>
          向 Copilot 提问
          <textarea
            value={question}
            maxLength={2000}
            onChange={(e) => {
              onQuestion(e.target.value);
            }}
          />
        </label>
        <div className="inline-actions">
          <label className="check-label">
            <input
              type="checkbox"
              checked={live}
              onChange={(e) => {
                onLive(e.target.checked);
              }}
            />
            启用 API 多 Agent
          </label>
          <button disabled={!question.trim() || blocked} onClick={onAnalyze}>
            运行分析
          </button>
        </div>
      </fieldset>
      <p className="hint">
        {live
          ? '调用后端已配置的模型服务，密钥只保留在后端。'
          : '当前为离线脚本演示，输出结构化证据，不是大模型推理。'}
      </p>
      {reports && (
        <div className="report-grid">
          {Object.entries(reports).map(([role, report]) => (
            <article key={role}>
              <h3>
                {{
                  plan_report: '生产计划分析',
                  resource_report: '设备资源分析',
                  decision_report: '方案协调结论',
                }[role] || role}
              </h3>
              <pre>{report}</pre>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
