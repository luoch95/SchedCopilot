import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
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
  headingLevel?: 2 | 3;
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
  headingLevel,
  actions,
}: Props) {
  const [timeSource, setTimeSource] = useState<'snapshot' | 'current'>('snapshot');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (timeSource !== 'current') return;
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 60_000);
    window.addEventListener('focus', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
    };
  }, [timeSource]);
  const marker = {
    time: timeSource === 'current' ? now : Date.parse(state.snapshot_time),
    label: timeSource === 'current' ? '当前时间' : '执行快照',
  };
  const Heading = (headingLevel ?? (compact ? 2 : 3)) === 2 ? 'h2' : 'h3';
  const publication = state.plan_publication;
  const faults = (
    publication?.version === state.baseline.version ? (publication.fault_traces ?? []) : []
  ).map((trace) => ({
    failure: trace.failure,
    faultTrace: { version: trace.version, affectedOperations: trace.affected_operations },
  }));
  const originalById = new Map(state.baseline.operations.map((op) => [op.id, op]));
  const affected = state.affected.map((id) => originalById.get(id)!);
  const planTimes = state.baseline.operations
    .flatMap((operation) => [Date.parse(operation.start), Date.parse(operation.end)])
    .filter(Number.isFinite);
  const formatDate = (time: number) =>
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(time);
  const firstDate = planTimes.length ? formatDate(Math.min(...planTimes)) : null;
  const lastDate = planTimes.length ? formatDate(Math.max(...planTimes)) : null;
  const executionDate = firstDate
    ? firstDate === lastDate
      ? firstDate
      : `${firstDate} — ${lastDate}`
    : '暂无排产';
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
            <span>
              {state.event_cancelled ? '故障已撤销' : `已保存故障 · ${state.event.machine_id}`}
            </span>
            <strong>
              {stamp(state.event.started_at)} →{' '}
              {state.event.recovered_at ? stamp(state.event.recovered_at) : '恢复未知'}
            </strong>
            <small>来源：{state.event.source}</small>
          </div>
        </div>
      )}

      <section
        className={`section${compact ? ' current-plan-card' : ''}`}
        aria-label="当前执行计划"
      >
        <div className="section-heading">
          <div>
            <Heading id="section-current-plan">当前执行计划</Heading>
            {compact && (
              <div className="hint plan-metadata-row">
                <PlanVersionTag
                  version={state.baseline.version}
                  publication={state.plan_publication}
                />
                <span className="plan-execution-date">执行日期：{executionDate}</span>
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
        <div className="plan-time-controls">
          <label>
            时间定位
            <select
              aria-label="执行计划时间定位"
              value={timeSource}
              onChange={(event) => {
                setNow(Date.now());
                setTimeSource(event.target.value as 'snapshot' | 'current');
              }}
            >
              <option value="snapshot">执行快照</option>
              <option value="current">当前时间</option>
            </select>
          </label>
          <span>
            {Number.isFinite(marker.time)
              ? `${marker.label}：${stamp(new Date(marker.time).toISOString())}（北京时间）`
              : '执行快照时间缺失，无法定位'}
          </span>
        </div>
        <div
          className={compact ? 'current-plan-body' : undefined}
          tabIndex={compact ? 0 : undefined}
          aria-label={compact ? '执行计划图表内容' : undefined}
        >
          <Gantt
            key={`plan-${state.baseline.fingerprint}`}
            schedule={state.baseline}
            failure={state.event}
            faults={faults}
            machines={state.machines}
            range={range}
            timeMarker={marker}
          />
          <p className="hint">
            竖线仅表示所选时间位置，实际进度以工序状态为准。
            浅色条为已完成工序，浅灰斜线底纹为设备停机留痕，悬停可查看说明。
            此图保留已发布安排，生成候选不会自动修改执行计划。
          </p>
        </div>
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
