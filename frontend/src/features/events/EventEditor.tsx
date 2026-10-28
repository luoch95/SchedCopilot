import { fullStamp, localInput, stamp } from '../../shared/lib/time';
import type { Workbench } from '../../shared/api/contracts';
import type { EventDraft } from './model';
import { WriteButton } from '../../shared/ui/WriteButton';
import { useDemoAccess } from '../../shared/lib/demoAccess';

function datePart(value: string) {
  return value.slice(0, 10);
}

function timePart(value: string) {
  return value.slice(11, 16);
}

function updateDateTime(value: string, part: 'date' | 'time', next: string) {
  const date = part === 'date' ? next : datePart(value);
  const time = part === 'time' ? next : timePart(value);
  return `${date}T${time}`;
}

interface Props {
  state: Workbench;
  draft: EventDraft;
  busy: string;
  stale: boolean;
  draftInvalid: boolean;
  onEdit: (value: Partial<EventDraft>) => void;
  onSave: () => void;
}

export function EventEditor({ state, draft, busy, stale, draftInvalid, onEdit, onSave }: Props) {
  const { readOnly } = useDemoAccess();
  return (
    <div className="event-editor">
      <div>
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
              disabled={readOnly}
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
          <div className="event-datetime" role="group" aria-label="故障开始时间">
            <label>
              故障日期
              <input
                type="date"
                disabled={readOnly}
                value={datePart(draft.started_at)}
                onChange={(e) =>
                  onEdit({ started_at: updateDateTime(draft.started_at, 'date', e.target.value) })
                }
              />
            </label>
            <label>
              开始时间
              <input
                type="time"
                disabled={readOnly}
                value={timePart(draft.started_at)}
                onChange={(e) =>
                  onEdit({ started_at: updateDateTime(draft.started_at, 'time', e.target.value) })
                }
              />
            </label>
          </div>
          <WriteButton
            className="text-button"
            onClick={() => onEdit({ started_at: localInput(state.snapshot_time) })}
          >
            使用{fullStamp(state.snapshot_time)}快照时间
          </WriteButton>
          <label className="check-label">
            <input
              type="checkbox"
              disabled={readOnly}
              checked={draft.unknown}
              onChange={(e) => onEdit({ unknown: e.target.checked })}
            />
            预计恢复时间未知
          </label>
          {!draft.unknown && (
            <div className="event-datetime" role="group" aria-label="预计恢复时间">
              <label>
                预计恢复日期
                <input
                  type="date"
                  disabled={readOnly}
                  value={datePart(draft.recovered_at)}
                  onChange={(e) =>
                    onEdit({
                      recovered_at: updateDateTime(draft.recovered_at, 'date', e.target.value),
                    })
                  }
                />
              </label>
              <label>
                预计恢复时间
                <input
                  type="time"
                  disabled={readOnly}
                  value={timePart(draft.recovered_at)}
                  onChange={(e) =>
                    onEdit({
                      recovered_at: updateDateTime(draft.recovered_at, 'time', e.target.value),
                    })
                  }
                />
              </label>
            </div>
          )}
          {draft.unknown && (
            <p className="hint">暂时只展示潜在风险；补充预计恢复时间后才能生成正式候选。</p>
          )}
          <label>
            事件来源
            <input
              maxLength={200}
              disabled={readOnly}
              value={draft.source}
              onChange={(e) => onEdit({ source: e.target.value })}
              placeholder="例如：维修班组人工估计"
            />
          </label>
          <p className="hint">时间均为 UTC+08:00，预计恢复时间由人工估计。</p>
          {draftInvalid && (
            <p className="inline-error">
              请填写开始时间、事件来源，并确保预计恢复时间晚于开始时间。
            </p>
          )}
          <WriteButton
            className="primary full-width"
            disabled={draftInvalid || stale}
            onClick={onSave}
          >
            保存故障事件
          </WriteButton>
        </fieldset>
      </div>
    </div>
  );
}
