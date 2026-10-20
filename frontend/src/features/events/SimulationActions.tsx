import type { Workbench } from '../../shared/api/contracts';
import { explainIssue } from './model';
export function SimulationActions({
  state,
  busy,
  blocked,
  onGenerate,
  onCancel,
  running,
  demoEnabled,
  demoRemaining,
  demoLoading,
  onDemoChange,
}: {
  state: Workbench;
  busy: string;
  blocked: boolean;
  onGenerate: () => void;
  onCancel: () => void;
  running: boolean;
  demoEnabled: boolean;
  demoRemaining: number;
  demoLoading: boolean;
  onDemoChange: (enabled: boolean) => void;
}) {
  return (
    <section className="simulation-actions">
      <div>
        <h2>生成候选方案</h2>
        <p>对比“原计划对照（原设备顺延）”与“允许合格设备转移”，不会修改执行计划。</p>
      </div>
      <div className="simulation-action-buttons">
        <button
          className={`primary${running ? ' is-running' : ''}`}
          disabled={blocked || !!busy || demoLoading}
          onClick={onGenerate}
          aria-label={running ? '生成候选方案 · 生成中' : '生成候选方案'}
        >
          {running ? (
            <>
              生成候选方案 · 生成中
              <span className="loading-dots" aria-hidden="true">
                ...
              </span>
            </>
          ) : (
            <>
              生成候选方案 <span aria-hidden="true">→</span>
            </>
          )}
        </button>
        {running && (
          <button className="cancel-workflow" onClick={onCancel} aria-label="取消">
            取消
          </button>
        )}
      </div>
      <details className="fallback-demo-controls">
        <summary>兜底演示</summary>
        <label>
          <input
            type="checkbox"
            checked={demoEnabled}
            disabled={!!busy || demoLoading || demoRemaining > 0}
            onChange={(event) => onDemoChange(event.target.checked)}
          />
          下一次生成模拟排产环节模型辅助失败（仅一次）
        </label>
        <p>
          {demoLoading
            ? '正在读取演示状态…'
            : demoRemaining > 0
              ? `演示冷却中，剩余 ${Math.ceil(demoRemaining / 60)} 分钟。可正常生成方案。`
              : '规则排产仍会执行，结果明确标注为模拟。触发后冷却 20 分钟，真实故障始终如实显示。'}
        </p>
      </details>
      {!!state.issues.length && (
        <div className="blockers" role="alert">
          <strong>当前事件与执行记录冲突</strong>
          {state.issues.map((issue) => (
            <p key={issue}>{explainIssue(state, issue)}</p>
          ))}
          <p>本案例固定在13:00；更改故障时间不会自动推进或回退工序状态。</p>
        </div>
      )}
      {!state.event.recovered_at && (
        <div className="blockers">
          已保存事件的恢复时间未知。请取消左侧“恢复时间未知”，填写恢复时间并保存。
        </div>
      )}
    </section>
  );
}
