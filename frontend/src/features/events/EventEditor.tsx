import { localInput, stamp } from '../../shared/lib/time';
import type { Workbench } from '../../shared/api/contracts';
import type { EventDraft } from './model';

interface Props {
  state: Workbench;
  draft: EventDraft;
  busy: string;
  stale: boolean;
  draftInvalid: boolean;
  onEdit: (value: Partial<EventDraft>) => void;
  onSave: () => void;
  onReload: () => void;
  onRecover: () => void;
}

export function EventEditor({
  state,
  draft,
  busy,
  stale,
  draftInvalid,
  onEdit,
  onSave,
  onReload,
  onRecover,
}: Props) {
  return (
    <aside className="sidebar">
      <a className="brand" href="#">
        <span className="brand-mark">SC</span>
        <span>排产辅助决策工作台</span>
      </a>
      <div className="sidebar-section">
        <h2>设备故障事件</h2>
        <p className="snapshot-note">
          仿真快照 <strong>{stamp(state.snapshot_time)}</strong>
          <br />
          当前只编辑一条故障，切换设备会替换事件。
        </p>
        <fieldset disabled={!!busy}>
          <label>
            故障设备
            <select
              value={draft.machine_id}
              onChange={(e) => onEdit({ machine_id: e.target.value })}
            >
              {state.machines.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.id} · {machine.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            故障开始时间
            <input
              type="datetime-local"
              value={draft.started_at}
              onChange={(e) => onEdit({ started_at: e.target.value })}
            />
          </label>
          <button
            className="text-button"
            onClick={() => onEdit({ started_at: localInput(state.snapshot_time) })}
          >
            使用13:00快照时间
          </button>
          <label className="check-label">
            <input
              type="checkbox"
              checked={draft.unknown}
              onChange={(e) => onEdit({ unknown: e.target.checked })}
            />
            恢复时间未知
          </label>
          {!draft.unknown && (
            <label>
              预计恢复时间
              <input
                type="datetime-local"
                value={draft.recovered_at}
                onChange={(e) => onEdit({ recovered_at: e.target.value })}
              />
            </label>
          )}
          {draft.unknown && (
            <p className="hint">暂时只展示潜在风险；补充恢复时间后才能生成正式候选。</p>
          )}
          <label>
            事件来源
            <input
              maxLength={200}
              value={draft.source}
              onChange={(e) => onEdit({ source: e.target.value })}
              placeholder="例如：维修班组人工估计"
            />
          </label>
          <p className="hint">时间均为 UTC+08:00，恢复时间由人工估计。</p>
          {draftInvalid && (
            <p className="inline-error">请填写开始时间、事件来源，并确保恢复时间晚于开始时间。</p>
          )}
          <button className="primary full-width" disabled={draftInvalid || stale} onClick={onSave}>
            保存故障事件
          </button>
          <button className="full-width" onClick={onReload}>
            重新载入已保存事件
          </button>
          <button className="full-width" disabled={stale} onClick={onRecover}>
            恢复上次可试算事件
          </button>
        </fieldset>
      </div>
      <div className="sidebar-footer">
        <span className="status-dot" />
        本地仿真 · 人工确认发布
        <br />
        <small>本地仿真 · 人工确认发布</small>
      </div>
    </aside>
  );
}
