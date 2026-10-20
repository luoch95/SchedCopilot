import type { Candidate, Simulation, Workbench } from '../../shared/api/contracts';
interface Props {
  state: Workbench;
  currentSimulation: Simulation;
  candidate: Candidate | undefined;
  busy: string;
  blocked: boolean;
  selected: string;
  reason: string;
  action: string;
  onSelected: (value: string) => void;
  onReason: (value: string) => void;
  onAction: (value: string) => void;
  onDecide: () => void;
}
export function DecisionPanel({
  state,
  currentSimulation,
  candidate,
  busy,
  blocked,
  selected,
  reason,
  action,
  onSelected,
  onReason,
  onAction,
  onDecide,
}: Props) {
  return (
    <section className="section decision-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">HUMAN IN THE LOOP</p>
          <h2>人工确认</h2>
        </div>
        <span className="tag">当前执行计划 V{state.baseline.version}</span>
      </div>
      <fieldset disabled={!!busy}>
        <div className="decision-fields">
          <label>
            本次处理的方案
            <select value={selected} onChange={(e) => onSelected(e.target.value)}>
              {currentSimulation.candidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            处理方式
            <select value={action} onChange={(e) => onAction(e.target.value)}>
              <option value="reject">暂不发布</option>
              <option value="publish">确认发布</option>
            </select>
          </label>
        </div>
        <label>
          确认理由（必填）
          <textarea
            maxLength={2000}
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            placeholder="说明选择理由以及接受的代价"
          />
        </label>
        {action === 'publish' && candidate?.metrics.moved_operations === 0 && (
          <p className="hint">该方案与当前计划相同，无需重复发布。</p>
        )}
        <div className="inline-actions">
          <p className="hint">
            {action === 'publish'
              ? `将发布“${candidate?.label}”，执行计划更新为 V${state.baseline.version + 1}。`
              : '只记录人工决定，执行计划保持不变。'}
          </p>
          <button
            className="primary"
            disabled={
              !reason.trim() ||
              blocked ||
              (action === 'publish' && candidate?.metrics.moved_operations === 0)
            }
            onClick={onDecide}
          >
            {action === 'publish' ? '确认并发布所选方案' : '记录暂不发布'}
          </button>
        </div>
      </fieldset>
    </section>
  );
}
