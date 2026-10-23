import { useId, useLayoutEffect, useState } from 'react';
import { statusLabel } from '../lib/status';
import { useEffect, useRef } from 'react';
import { stamp } from '../lib/time';
import type { Change, Failure, Machine, Operation, Schedule } from '../api/contracts';
import { DecisionText } from './DecisionText';
import { useGanttSelection } from './GanttSelection';

const colors = ['#2E748C', '#489B78', '#A87939', '#7B71A4', '#C17467'];
const comparisonColors = {
  red: ['#B83F45', '#A94D59', '#C65D46', '#963F57', '#B45F64'],
  green: ['#24744F', '#388360', '#437A45', '#21685D', '#52864E'],
};
const hour = (value: number) => stamp(new Date(value).toISOString()).split(' ')[1];
type FaultOverlay = {
  failure: Failure;
  faultTrace?: { version: number; affectedOperations: Operation[] };
};

export default function Gantt({
  schedule,
  baseline,
  failure,
  machines,
  range,
  changes = [],
  tone,
  faultTrace,
  faults,
  onMove,
}: {
  schedule: Schedule;
  baseline?: Schedule;
  failure: Failure;
  machines: Machine[];
  range: [number, number];
  changes?: Change[];
  tone?: 'red' | 'green';
  faultTrace?: { version: number; affectedOperations: Operation[] };
  faults?: FaultOverlay[];
  onMove?: (operationId: string, machineId: string, start: string) => unknown;
}) {
  const drag = useRef<{
    id: string;
    x: number;
    y: number;
    start: number;
    row: number;
    scale: number;
  } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ id: string; x: number; y: number } | null>(null);
  const overlays = faults ?? [{ failure, faultTrace }];
  const [hoveredFault, setHoveredFault] = useState(0);
  const activeFault = overlays[hoveredFault] ?? { failure, faultTrace };
  const patternId = `fault-pattern-${useId().replace(/:/g, '')}`;
  const tooltipId = useId();
  const [faultHovered, setFaultHovered] = useState(false);
  const [faultAnchor, setFaultAnchor] = useState({ x: 0, y: 0 });
  const [tooltipPosition, setTooltipPosition] = useState({ left: 0, top: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const palette = tone ? comparisonColors[tone] : colors;
  const sharedSelection = useGanttSelection();
  const [localSelection, setLocalSelection] = useState<string | null>(null);
  const selectedId = sharedSelection?.operationId ?? localSelection;
  const select = sharedSelection?.select ?? setLocalSelection;
  const [hover, setHover] = useState<Operation | null>(null);
  useEffect(() => {
    setFaultHovered(false);
    setHover(null);
  }, [failure.machine_id, failure.started_at, failure.recovered_at, schedule.fingerprint]);
  const chartRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(920);
  useEffect(() => {
    const container = chartRef.current;
    if (!container) return;
    const updateWidth = () => {
      setFaultHovered(false);
      const measured = container.getBoundingClientRect().width;
      if (measured > 0) setWidth(Math.max(120, measured));
    };
    updateWidth();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateWidth);
    observer?.observe(container);
    window.addEventListener('resize', updateWidth);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, []);
  useLayoutEffect(() => {
    const chart = chartRef.current;
    const tooltip = tooltipRef.current;
    if (!faultHovered || !chart || !tooltip) return;
    const bounds = chart.getBoundingClientRect();
    const tip = tooltip.getBoundingClientRect();
    const mouseX = faultAnchor.x - bounds.left;
    const mouseY = faultAnchor.y - bounds.top;
    const inset = 8;
    const gap = 12;
    const desiredX =
      mouseX + gap + tip.width > bounds.width - inset ? mouseX - tip.width - gap : mouseX + gap;
    const desiredY =
      mouseY + gap + tip.height > bounds.height - inset ? mouseY - tip.height - gap : mouseY + gap;
    setTooltipPosition({
      left:
        chart.scrollLeft + Math.max(inset, Math.min(desiredX, bounds.width - tip.width - inset)),
      top:
        chart.scrollTop + Math.max(inset, Math.min(desiredY, bounds.height - tip.height - inset)),
    });
  }, [faultHovered, faultAnchor]);
  const left = 65,
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
  const eventTicks = overlays
    .flatMap(({ failure }) => [failure.started_at, failure.recovered_at])
    .filter((value): value is string => !!value)
    .map((value) => +new Date(value));
  const step = range[1] - range[0] > 18 * 3600_000 ? 2 * 3600_000 : 3600_000;
  const firstHour = Math.ceil(range[0] / step) * step;
  const hourlyTicks: number[] = [];
  for (let tick = firstHour; tick < range[1]; tick += step) hourlyTicks.push(tick);
  const ticks = [
    ...new Set([
      range[0],
      range[1],
      ...hourlyTicks,
      ...eventTicks.filter((tick) => tick >= range[0] && tick <= range[1]),
    ]),
  ].sort((a, b) => a - b);
  // Reserve both endpoint labels before fitting intermediate labels into the SVG space.
  // Keep grid lines (including failure boundaries) even when their labels do not fit.
  const labelWidth = 42;
  const labelGap = 14;
  const visibleLabels = new Set([range[0], range[1]]);
  let previousLabelRight = x(range[0]) + labelWidth;
  const lastLabelLeft = x(range[1]) - labelWidth;
  for (const tick of ticks) {
    if (tick === range[0] || tick === range[1]) continue;
    const labelLeft = x(tick) - labelWidth / 2;
    const labelRight = x(tick) + labelWidth / 2;
    if (labelLeft >= previousLabelRight + labelGap && labelRight + labelGap <= lastLabelLeft) {
      visibleLabels.add(tick);
      previousLabelRight = labelRight;
    }
  }
  const inspected = hover ?? schedule.operations.find((op) => op.id === selectedId) ?? null;
  const before = inspected && baseline?.operations.find((op) => op.id === inspected.id);
  const change = inspected && changes.find((item) => item.工序 === inspected.id);
  const activeFailure = activeFault.failure;
  const activeTrace = activeFault.faultTrace;
  const faultEnd = activeFailure.recovered_at ? +new Date(activeFailure.recovered_at) : range[1];
  const conflicts = schedule.operations.filter(
    (op) =>
      op.machine_id === activeFailure.machine_id &&
      op.status === 'planned' &&
      Date.parse(op.start) < faultEnd &&
      Date.parse(op.end) > Date.parse(activeFailure.started_at),
  );
  const allTransferred =
    !!activeTrace?.affectedOperations.length &&
    activeTrace.affectedOperations.every((original) =>
      schedule.operations.some(
        (op) => op.id === original.id && op.machine_id !== activeFailure.machine_id,
      ),
    );
  const faultDescription = `${activeTrace ? `V${activeTrace.version} 变更留痕：` : '设备停机窗口：'}因 ${activeFailure.machine_id} 设备故障（${hour(Date.parse(activeFailure.started_at))}—${activeFailure.recovered_at ? hour(Date.parse(activeFailure.recovered_at)) : '恢复时间未知'}），${conflicts.length ? `当前仍有 ${conflicts.length} 道工序与停机窗口重叠，需调整排产` : allTransferred ? '相关订单工序已全部转移' : activeTrace ? '相关工序已调整避开停机窗口' : '当前窗口内无排产冲突'}，当前时段设备不可用。`;
  return (
    <div className="gantt">
      <div className="chart-scroll" ref={chartRef} onScroll={() => setFaultHovered(false)}>
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="设备工序甘特图"
        >
          <defs>
            <pattern id={patternId} width="8" height="8" patternUnits="userSpaceOnUse">
              <rect width="8" height="8" fill="#f5f2f2" />
              <path
                d="M-2 2L2-2M0 8L8 0M6 10L10 6"
                stroke="#d9cfd0"
                strokeWidth="0.6"
                strokeOpacity="0.55"
              />
            </pattern>
          </defs>
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={x(tick)}
                x2={x(tick)}
                y1={28}
                y2={height - 20}
                stroke={eventTicks.includes(tick) ? '#D3CDCE' : '#DFE6EB'}
                strokeDasharray={eventTicks.includes(tick) ? '3 3' : undefined}
              />
              {visibleLabels.has(tick) && (
                <text
                  x={x(tick)}
                  y={19}
                  textAnchor={tick === range[0] ? 'start' : tick === range[1] ? 'end' : 'middle'}
                  className="axis-label"
                >
                  {hour(tick)}
                </text>
              )}
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
              {overlays.map(({ failure }, faultIndex) => {
                const faultEnd = failure.recovered_at ? +new Date(failure.recovered_at) : range[1];
                return (
                  machine.id === failure.machine_id &&
                  x(faultEnd) > left &&
                  x(failure.started_at) < width - right && (
                    <g
                      key={`${failure.machine_id}-${failure.started_at}-${failure.recovered_at}`}
                      className="gantt-fault-region"
                      tabIndex={0}
                      role="group"
                      aria-label={`${machine.id} 停机留痕`}
                      aria-describedby={
                        faultHovered && hoveredFault === faultIndex ? tooltipId : undefined
                      }
                      onMouseEnter={(event) => {
                        setHoveredFault(faultIndex);
                        setFaultAnchor({ x: event.clientX, y: event.clientY });
                        setFaultHovered(true);
                        setHover(null);
                      }}
                      onMouseMove={(event) =>
                        setFaultAnchor({ x: event.clientX, y: event.clientY })
                      }
                      onMouseLeave={() => setFaultHovered(false)}
                      onFocus={(event) => {
                        setHoveredFault(faultIndex);
                        const bounds = event.currentTarget.getBoundingClientRect();
                        setFaultAnchor({ x: bounds.left + bounds.width / 2, y: bounds.top });
                        setFaultHovered(true);
                      }}
                      onBlur={() => setFaultHovered(false)}
                    >
                      <rect
                        x={Math.max(left, x(failure.started_at))}
                        y={top + index * rowHeight + 2}
                        width={Math.max(
                          0,
                          Math.min(width - right, x(faultEnd)) -
                            Math.max(left, x(failure.started_at)),
                        )}
                        height={rowHeight - 11}
                        fill={`url(#${patternId})`}
                        stroke="#ded6d6"
                      />
                      <text
                        x={Math.max(left, x(failure.started_at)) + 5}
                        y={top + index * rowHeight + 13}
                        className="fault-label"
                        pointerEvents="none"
                      >
                        ⚠ 停机留痕
                      </text>
                    </g>
                  )
                );
              })}
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
              <g
                key={op.id}
                className={`gantt-operation${selectedId === op.id ? ' gantt-operation-selected' : ''}`}
                data-operation-id={op.id}
                data-selected={selectedId === op.id}
                style={{
                  cursor: onMove && op.status === 'planned' ? 'grab' : undefined,
                  touchAction: onMove ? 'none' : undefined,
                }}
                transform={
                  dragOffset?.id === op.id
                    ? `translate(${dragOffset.x},${dragOffset.y})`
                    : undefined
                }
                onPointerDown={(event) => {
                  if (!onMove || op.status !== 'planned' || event.button !== 0) return;
                  const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
                  if (!bounds?.width) return;
                  drag.current = {
                    id: op.id,
                    x: event.clientX,
                    y: event.clientY,
                    start: Date.parse(op.start),
                    row,
                    scale: width / bounds.width,
                  };
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  event.preventDefault();
                }}
                onPointerMove={(event) => {
                  const active = drag.current;
                  if (!active || active.id !== op.id || !onMove) return;
                  setDragOffset({
                    id: op.id,
                    x: (event.clientX - active.x) * active.scale,
                    y: (event.clientY - active.y) * active.scale,
                  });
                }}
                onPointerCancel={() => {
                  drag.current = null;
                  setDragOffset(null);
                }}
                onPointerUp={(event) => {
                  const active = drag.current;
                  drag.current = null;
                  setDragOffset(null);
                  if (!active || active.id !== op.id || !onMove) return;
                  const dx = (event.clientX - active.x) * active.scale;
                  const dy = (event.clientY - active.y) * active.scale;
                  if (Math.abs(dx) + Math.abs(dy) < 4) return;
                  const minutes =
                    Math.round(((dx / (width - left - right)) * (range[1] - range[0])) / 300000) *
                    5;
                  const machine =
                    machines[
                      Math.max(
                        0,
                        Math.min(machines.length - 1, active.row + Math.round(dy / rowHeight)),
                      )
                    ];
                  void onMove(
                    op.id,
                    machine.id,
                    new Date(active.start + minutes * 60000).toISOString(),
                  );
                }}
                onMouseEnter={() => setHover(op)}
                onMouseLeave={() => setHover(null)}
                onClick={() => {
                  // Dragging a label selects text; do not turn copying into another action.
                  if (window.getSelection()?.isCollapsed === false) return;
                  select(op.id);
                }}
              >
                <rect
                  x={start}
                  y={y}
                  width={end - start}
                  height={29}
                  rx={4}
                  fill={palette[orderIds.indexOf(op.order_id) % palette.length]}
                  fillOpacity={op.status === 'completed' ? 0.42 : 1}
                  stroke={transfer ? '#7C3AED' : changed ? '#B45309' : 'transparent'}
                  strokeWidth={changed ? 4 : 0}
                  tabIndex={0}
                  role="graphics-symbol"
                  aria-label={`${op.display_name ?? op.id} ${op.machine_id} ${stamp(op.start)} 至 ${stamp(op.end)}${transfer ? ' 设备转移' : changed ? ' 时间调整' : ''}`}
                  onKeyDown={(event) => {
                    if (
                      onMove &&
                      op.status === 'planned' &&
                      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
                    ) {
                      event.preventDefault();
                      const targetRow = Math.max(
                        0,
                        Math.min(
                          machines.length - 1,
                          row + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0),
                        ),
                      );
                      const offset =
                        event.key === 'ArrowRight'
                          ? 300000
                          : event.key === 'ArrowLeft'
                            ? -300000
                            : 0;
                      void onMove(
                        op.id,
                        machines[targetRow].id,
                        new Date(Date.parse(op.start) + offset).toISOString(),
                      );
                      return;
                    }
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      select(op.id);
                    }
                  }}
                  onFocus={() => setHover(op)}
                  onBlur={() => setHover(null)}
                >
                  <title>{`${op.display_name ?? op.id} · ${op.machine_id}\n${stamp(op.start)} → ${stamp(op.end)}`}</title>
                </rect>
                {end - start > 78 && (
                  <text x={(start + end) / 2} y={y + 19} textAnchor="middle" className="bar-label">
                    {op.display_name ?? op.id}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {faultHovered && (
          <div
            ref={tooltipRef}
            style={tooltipPosition}
            className="gantt-fault-tooltip"
            role="tooltip"
            id={tooltipId}
          >
            {faultDescription}
          </div>
        )}
      </div>
      <div className="gantt-inspector" aria-live="polite">
        {inspected ? (
          <>
            <strong>{inspected.display_name ?? inspected.id}</strong>
            <span>
              {inspected.machine_id} · {stamp(inspected.start)} → {stamp(inspected.end)}
            </span>
            <span>
              {statusLabel(inspected.status)}
              {before &&
              (before.machine_id !== inspected.machine_id || before.start !== inspected.start)
                ? ` · 原安排 ${before.machine_id} / ${stamp(before.start)}`
                : ''}
            </span>
          </>
        ) : (
          <span>悬停或聚焦工序条，查看设备、起止时间与调整前安排</span>
        )}
      </div>
      {change && (
        <p className="hint">
          调整依据：
          <DecisionText text={businessText(change.依据, schedule.operations)} />
        </p>
      )}
      <div className="order-legend">
        {orderIds.map((id, index) => (
          <span key={id}>
            <i style={{ background: palette[index % palette.length] }} />
            {schedule.operations.find((op) => op.order_id === id)?.order_display_name ?? id}
          </span>
        ))}
      </div>
    </div>
  );
}
import { businessText } from '../lib/businessLabels';
