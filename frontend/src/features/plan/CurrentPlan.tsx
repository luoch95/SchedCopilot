import type { ReactNode } from 'react';
import { PlanVersionTag } from './PlanVersionTag';
import { stamp } from '../../shared/lib/time';
import Gantt from '../../shared/ui/Gantt';
import type { Workbench } from '../../shared/api/contracts';

interface Props {
  state: Workbench;
  range: [number, number];
  zoom: number;
  pan: number;
  onZoom: (value: number) => void;
  onPan: (value: number) => void;
  compact?: boolean;
  actions?: ReactNode;
}

export function CurrentPlan({
  state,
  range,
  zoom,
  pan,
  onZoom,
  onPan,
  compact = false,
  actions,
}: Props) {
  const originalById = new Map(state.baseline.operations.map((op) => [op.id, op]));
  const affected = state.affected.map((id) => originalById.get(id)!);
  return (
    <>
      {!compact && (
        <div className="stat-strip">
          <div>
            <span>{state.event.recovered_at ? '直接受影响工序' : '潜在受影响工序'}</span>
            <strong>
              {state.affected.length}
              <small>道</small>
            </strong>
          </div>
          <div>
            <span>执行计划版本</span>
            <PlanVersionTag version={state.baseline.version} publication={state.plan_publication} />
          </div>
          <div>
            <span>故障信息修订版</span>
            <span className="event-revision-tag">第 {state.event_revision} 版</span>
          </div>
          <div className="event-stat">
            <span>已保存故障 · {state.event.machine_id}</span>
            <strong>
              {stamp(state.event.started_at)} →{' '}
              {state.event.recovered_at ? stamp(state.event.recovered_at) : '恢复未知'}
            </strong>
            <small>来源：{state.event.source}</small>
          </div>
        </div>
      )}

      <section className="section">
        <div className="section-heading">
          <div>
            {compact ? <h2>当前执行计划</h2> : <h3 id="section-current-plan">当前执行计划</h3>}
            {compact && (
              <div className="hint plan-metadata-row">
                <PlanVersionTag
                  version={state.baseline.version}
                  publication={state.plan_publication}
                />
                <span>
                  已保存故障 {state.event.machine_id} · {stamp(state.event.started_at)} →{' '}
                  {state.event.recovered_at ? stamp(state.event.recovered_at) : '恢复时间未知'}
                </span>
              </div>
            )}
          </div>
          <div className="chart-controls">
            {actions}
            <label>
              共同缩放
              <input
                aria-label="甘特图缩放"
                type="range"
                min={1}
                max={4}
                step={0.25}
                value={zoom}
                onChange={(e) => onZoom(+e.target.value)}
              />
            </label>
            <label>
              查看起点
              <input
                aria-label="甘特图查看起点"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={pan}
                disabled={zoom === 1}
                onChange={(e) => onPan(+e.target.value)}
              />
            </label>
          </div>
        </div>
        <Gantt
          schedule={state.baseline}
          failure={state.event}
          machines={state.machines}
          range={range}
        />
        <p className="hint">
          浅色条为已完成工序，红色阴影及虚线区域为已保存的故障窗口。
          此图保留已发布安排，生成候选不会自动修改执行计划。
        </p>
        {!compact && (
          <>
            <h3 id="section-impact" className="block-title">
              {state.event.recovered_at ? '直接影响范围' : '潜在风险范围'}
            </h3>
            {affected.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>工序</th>
                      <th>订单</th>
                      <th>设备</th>
                      <th>原加工时段</th>
                      <th>依据</th>
                    </tr>
                  </thead>
                  <tbody>
                    {affected.map((op) => (
                      <tr key={op.id}>
                        <th>{op.display_name ?? op.id}</th>
                        <td>{op.order_display_name ?? op.order_id}</td>
                        <td>{op.machine_id}</td>
                        <td>
                          {stamp(op.start)} → {stamp(op.end)}
                        </td>
                        <td>
                          {state.event.recovered_at ? '与故障窗口重叠' : '恢复未知，列为潜在风险'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-state">
                已保存故障未覆盖任何待加工工序，可以试算验证是否需要调整。
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}
