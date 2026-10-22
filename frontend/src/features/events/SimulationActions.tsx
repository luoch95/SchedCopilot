import type { Workbench, WorkflowResult } from '../../shared/api/contracts';
import { AiAnalysisButton } from '../../shared/ui/AiAnalysisButton';
import { useDemoAccess } from '../../shared/lib/demoAccess';
import { explainIssue } from './model';
import { businessText } from '../../shared/lib/businessLabels';

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
  workflow,
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
  workflow?: WorkflowResult | null;
}) {
  const { readOnly } = useDemoAccess();
  const hasAlert = workflow?.status === 'blocked';
  return (
    <section className="simulation-actions">
      <div>
        <h2 id="section-generation">智能分析链路</h2>
        <p>对比原计划顺延与允许合格设备转移，不会修改执行计划。</p>
      </div>
      <div className="simulation-action-buttons">
        {(!hasAlert || running) && (
          <AiAnalysisButton
            label={running ? 'AI 正在分析并生成候选方案' : '开始 AI 分析并生成候选方案'}
            disabled={blocked || !!busy || demoLoading}
            onClick={onGenerate}
            write
          />
        )}
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
            disabled={readOnly || !!busy || demoLoading || demoRemaining > 0}
            onChange={(event) => onDemoChange(event.target.checked)}
          />
          下一次生成模拟排产环节模型辅助失败（仅一次）
        </label>
        <p>
          {demoLoading
            ? '正在读取演示状态…'
            : demoRemaining > 0
              ? `演示冷却中，剩余 ${Math.ceil(demoRemaining / 60)} 分钟。可正常生成方案。`
              : '规则排产仍会执行，结果明确标注为模拟。触发后冷却 20 分钟。'}
        </p>
      </details>
      {!!state.issues.length && (
        <div className="blockers" role="alert">
          <strong>当前事件与执行记录冲突</strong>
          {state.issues.map((issue) => (
            <p key={issue}>{businessText(explainIssue(state, issue), state.baseline.operations)}</p>
          ))}
          <p>更改故障时间不会自动推进或回退工序状态。</p>
        </div>
      )}
      {!state.event.recovered_at && (
        <div className="blockers">已保存事件的恢复时间未知，请补充恢复时间并保存。</div>
      )}
    </section>
  );
}
