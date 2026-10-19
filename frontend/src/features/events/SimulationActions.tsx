import type { Workbench } from '../../shared/api/contracts';
import { explainIssue } from './model';
export function SimulationActions({
  state,
  busy,
  blocked,
  onGenerate,
}: {
  state: Workbench;
  busy: string;
  blocked: boolean;
  onGenerate: () => void;
}) {
  return (
    <section className="simulation-actions">
      <div>
        <h2>生成候选方案</h2>
        <p>对比“原计划对照（原设备顺延）”与“允许合格设备转移”，不会修改正式计划。</p>
      </div>
      <button className="primary" disabled={blocked || !!busy} onClick={onGenerate}>
        生成候选方案 <span aria-hidden="true">→</span>
      </button>
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
