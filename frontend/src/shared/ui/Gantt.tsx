import { useState } from 'react';
import { stamp } from '../lib/time';
import type { Failure, Machine, Operation, Schedule } from '../api/contracts';

const colors = ['#2E748C', '#489B78', '#A87939', '#7B71A4', '#C17467'];
const hour = (value: number) => stamp(new Date(value).toISOString()).split(' ')[1];

export default function Gantt({
  schedule,
  baseline,
  failure,
  machines,
  range,
}: {
  schedule: Schedule;
  baseline?: Schedule;
  failure: Failure;
  machines: Machine[];
  range: [number, number];
}) {
  const [hover, setHover] = useState<Operation | null>(null);
  const width = 920,
    left = 65,
    right = 18,
    rowHeight = 66,
    top = 46;
  const height = top + machines.length * rowHeight + 34;
  const x = (value: string | number) =>
    left +
    ((Number(typeof value === 'string' ? new Date(value) : value) - range[0]) /
      (range[1] - range[0])) *
      (width - left - right);
  const orderIds = [...new Set(schedule.operations.map((op) => op.order_id))].sort();
  const eventTicks = [failure.started_at, failure.recovered_at]
    .filter((value): value is string => !!value)
    .map((value) => +new Date(value));
  const step = range[1] - range[0] > 18 * 3600_000 ? 2 * 3600_000 : 3600_000;
  const firstHour = Math.ceil(range[0] / step) * step;
  const hourlyTicks: number[] = [];
  for (let tick = firstHour; tick < range[1]; tick += step) hourlyTicks.push(tick);
  const ticks = [...new Set([range[0], range[1], ...hourlyTicks, ...eventTicks])].sort(
    (a, b) => a - b,
  );
  const before = hover && baseline?.operations.find((op) => op.id === hover.id);
  const faultEnd = failure.recovered_at ? +new Date(failure.recovered_at) : range[1];
  return (
    <div className="gantt">
      <div className="chart-scroll">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="设备工序甘特图">
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={x(tick)}
                x2={x(tick)}
                y1={28}
                y2={height - 20}
                stroke={eventTicks.includes(tick) ? '#CF8F80' : '#DFE6EB'}
                strokeDasharray={eventTicks.includes(tick) ? '3 3' : undefined}
              />
              <text x={x(tick)} y={19} textAnchor="middle" className="axis-label">
                {hour(tick)}
              </text>
            </g>
          ))}
          {machines.map((machine, index) => (
            <g key={machine.id}>
              <rect
                x={left}
                y={top + index * rowHeight}
                width={width - left - right}
                height={rowHeight - 7}
                fill={index % 2 ? '#F4F7F9' : '#FAFCFD'}
              />
              <text
                x={left - 12}
                y={top + index * rowHeight + 30}
                textAnchor="end"
                className="machine-label"
              >
                {machine.id}
              </text>
              {machine.id === failure.machine_id &&
                x(faultEnd) > left &&
                x(failure.started_at) < width - right && (
                  <>
                    <rect
                      x={Math.max(left, x(failure.started_at))}
                      y={top + index * rowHeight + 2}
                      width={Math.max(
                        0,
                        Math.min(width - right, x(faultEnd)) -
                          Math.max(left, x(failure.started_at)),
                      )}
                      height={rowHeight - 11}
                      fill="#F6DAD5"
                      stroke="#CF8F80"
                      strokeDasharray="4 3"
                    />
                    <text
                      x={Math.max(left, x(failure.started_at)) + 5}
                      y={top + index * rowHeight + 13}
                      className="fault-label"
                    >
                      故障{failure.recovered_at ? '' : ' · 恢复未知'}
                    </text>
                  </>
                )}
            </g>
          ))}
          {schedule.operations.map((op) => {
            const original = baseline?.operations.find((item) => item.id === op.id);
            const transfer = original && original.machine_id !== op.machine_id;
            const changed = transfer || (original && original.start !== op.start);
            const start = Math.max(left, x(op.start)),
              end = Math.min(width - right, x(op.end));
            if (end <= start) return null;
            const row = machines.findIndex((item) => item.id === op.machine_id);
            const y = top + row * rowHeight + 20;
            return (
              <g key={op.id} onMouseEnter={() => setHover(op)} onMouseLeave={() => setHover(null)}>
                <rect
                  x={start}
                  y={y}
                  width={end - start}
                  height={29}
                  rx={4}
                  fill={colors[orderIds.indexOf(op.order_id) % colors.length]}
                  fillOpacity={op.status === 'completed' ? 0.42 : 1}
                  stroke={transfer ? '#7C3AED' : changed ? '#B45309' : 'transparent'}
                  strokeWidth={changed ? 4 : 0}
                  tabIndex={0}
                  role="graphics-symbol"
                  aria-label={`${op.id} ${op.machine_id} ${stamp(op.start)} 至 ${stamp(op.end)}${transfer ? ' 设备转移' : changed ? ' 时间调整' : ''}`}
                  onFocus={() => setHover(op)}
                  onBlur={() => setHover(null)}
                >
                  <title>{`${op.id} · ${op.machine_id}\n${stamp(op.start)} → ${stamp(op.end)}`}</title>
                </rect>
                {end - start > 78 && (
                  <text
                    x={(start + end) / 2}
                    y={y + 19}
                    textAnchor="middle"
                    className="bar-label"
                    pointerEvents="none"
                  >
                    {op.id}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="gantt-inspector" aria-live="polite">
        {hover ? (
          <>
            <strong>{hover.id}</strong>
            <span>
              {hover.machine_id} · {stamp(hover.start)} → {stamp(hover.end)}
            </span>
            <span>
              {hover.status === 'completed'
                ? '已完成'
                : hover.status === 'in_progress'
                  ? '加工中'
                  : '待加工'}
              {before && (before.machine_id !== hover.machine_id || before.start !== hover.start)
                ? ` · 原安排 ${before.machine_id} / ${stamp(before.start)}`
                : ''}
            </span>
          </>
        ) : (
          <span>悬停或聚焦工序条，查看设备、起止时间与调整前安排</span>
        )}
      </div>
      <div className="order-legend">
        {orderIds.map((id, index) => (
          <span key={id}>
            <i style={{ background: colors[index % colors.length] }} />
            {id}
          </span>
        ))}
      </div>
    </div>
  );
}
