import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GanttSelectionProvider } from './GanttSelection';
import { Comparison } from '../../features/comparison';
import Gantt from './Gantt';
import { simulation, workbench } from '../../test/fixtures';

const range: [number, number] = [
  +new Date('2026-10-19T13:00:00+08:00'),
  +new Date('2026-10-19T18:00:00+08:00'),
];

it('recalculates chart coordinates and label spacing on container and window resize, then cleans up', () => {
  let measuredWidth = 1200;
  let notifyResize: () => void = () => {};
  const observe = vi.fn();
  const disconnect = vi.fn();
  const measurement = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(() => ({ width: measuredWidth }) as DOMRect);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        notifyResize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const removeListener = vi.spyOn(window, 'removeEventListener');
  try {
    const { unmount } = render(
      <Gantt
        schedule={workbench.baseline}
        failure={workbench.event}
        machines={workbench.machines}
        range={range}
      />,
    );
    const svg = screen.getByRole('img', { name: '设备工序甘特图' });
    const height = 46 + workbench.machines.length * 66 + 34;
    expect(svg.getAttribute('viewBox')).toBe(`0 0 1200 ${height}`);
    const wideLabels = svg.querySelectorAll('.axis-label').length;
    measuredWidth = 320;
    act(() => notifyResize());
    expect(svg.getAttribute('viewBox')).toBe(`0 0 320 ${height}`);
    expect(svg.querySelectorAll('.axis-label').length).toBeLessThan(wideLabels);
    expect(svg.querySelector('.axis-label')?.textContent).toBe('13:00');
    expect([...svg.querySelectorAll('.axis-label')].at(-1)?.textContent).toBe('18:00');
    measuredWidth = 760;
    fireEvent(window, new Event('resize'));
    expect(svg.getAttribute('viewBox')).toBe(`0 0 760 ${height}`);
    expect(observe).toHaveBeenCalled();
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
  } finally {
    measurement.mockRestore();
    removeListener.mockRestore();
    vi.unstubAllGlobals();
  }
});

describe('Gantt baseline comparison', () => {
  it('shows candidate timing and its reason without drawing old-position boxes', () => {
    const candidate = simulation.candidates[0];
    const before = workbench.baseline.operations[0];
    const after = candidate.schedule.operations[0];
    render(
      <Gantt
        schedule={candidate.schedule}
        baseline={workbench.baseline}
        failure={workbench.event}
        machines={workbench.machines}
        range={range}
        changes={[
          {
            工序: before.id,
            订单: before.order_id,
            类型: '直接影响',
            原设备: before.machine_id,
            新设备: after.machine_id,
            原开始: before.start,
            新开始: after.start,
            原结束: before.end,
            新结束: after.end,
            '时间变化(分钟)': 240,
            依据: '故障:M1',
            影响链: '故障:M1 → O1-OP1',
          },
        ]}
      />,
    );
    expect(screen.queryByRole('graphics-symbol', { name: /^原安排/ })).toBeNull();
    const moved = screen.getByRole('graphics-symbol', { name: /^O1-OP1 M1.*时间调整$/ });
    fireEvent.focus(moved);
    expect(screen.getByText('调整依据：故障:M1')).toBeTruthy();
    expect(workbench.baseline.operations[0].start).toBe('2026-10-19T13:00:00+08:00');
  });

  it('draws only the new machine position after transfer', () => {
    render(
      <Gantt
        schedule={simulation.candidates[1].schedule}
        baseline={workbench.baseline}
        failure={workbench.event}
        machines={workbench.machines}
        range={range}
      />,
    );
    expect(screen.queryByRole('graphics-symbol', { name: /^原安排/ })).toBeNull();
    const moved = screen.getByRole('graphics-symbol', { name: /^O1-OP1 M2.*设备转移$/ });
    expect(moved.getAttribute('stroke')).toBe('#7C3AED');
    expect(screen.getAllByRole('graphics-symbol')).toHaveLength(1);
  });
});

it('links the same operation across candidate charts in either direction and supports keyboard selection', () => {
  render(<Comparison state={workbench} simulation={simulation} range={range} workflow={null} />);
  const bars = screen.getAllByRole('graphics-symbol');
  expect(bars).toHaveLength(2);
  fireEvent.click(bars[0]);
  expect(
    bars.every((bar) => bar.parentElement?.classList.contains('gantt-operation-selected')),
  ).toBe(true);
  fireEvent.keyDown(bars[1], { key: 'Enter' });
  expect(bars.every((bar) => bar.parentElement?.dataset.selected === 'true')).toBe(true);
  expect(bars[1].getAttribute('stroke')).toBe('#7C3AED');
});

it('keeps independent comparison scopes separate and does not select an unrelated operation', () => {
  const renderChart = (id: string) => (
    <Gantt
      schedule={{
        ...workbench.baseline,
        operations: [{ ...workbench.baseline.operations[0], id }],
      }}
      failure={workbench.event}
      machines={workbench.machines}
      range={range}
    />
  );
  render(
    <>
      <GanttSelectionProvider>
        {renderChart('O1-OP1')}
        {renderChart('O2-OP1')}
      </GanttSelectionProvider>
      <GanttSelectionProvider>{renderChart('O1-OP1')}</GanttSelectionProvider>
    </>,
  );
  const bars = screen.getAllByRole('graphics-symbol');
  fireEvent.click(bars[0]);
  expect(bars.map((bar) => bar.parentElement?.dataset.selected)).toEqual([
    'true',
    'false',
    'false',
  ]);
});

it('allows label pointer selection and leaves text dragging separate from operation clicks', () => {
  render(
    <Gantt
      schedule={workbench.baseline}
      failure={workbench.event}
      machines={workbench.machines}
      range={range}
    />,
  );
  const bar = screen.getByRole('graphics-symbol');
  const label = bar.parentElement?.querySelector('text');
  expect(label?.getAttribute('pointer-events')).toBeNull();
  const selection = vi
    .spyOn(window, 'getSelection')
    .mockReturnValue({ isCollapsed: false } as Selection);
  try {
    fireEvent.click(label!);
    expect(bar.parentElement?.dataset.selected).toBe('false');
    selection.mockReturnValue({ isCollapsed: true } as Selection);
    fireEvent.click(label!);
    expect(bar.parentElement?.dataset.selected).toBe('true');
    fireEvent.mouseLeave(bar.parentElement!);
    expect(document.querySelector('.gantt-inspector')?.textContent).toContain('O1-OP1');
  } finally {
    selection.mockRestore();
  }
});

describe('Gantt time axis label spacing', () => {
  const draw = (start: string, end: string) =>
    render(
      <Gantt
        schedule={workbench.baseline}
        failure={{ ...workbench.event, started_at: '2026-10-19T22:59:00+08:00' }}
        machines={workbench.machines}
        range={[+new Date(start), +new Date(end)]}
      />,
    );

  it('reserves the exact end time and hides crowded hourly and event labels', () => {
    const { container } = draw('2026-10-19T00:00:00+08:00', '2026-10-19T23:08:00+08:00');
    const labels = [...container.querySelectorAll('.axis-label')];
    expect(labels.at(-1)?.textContent).toBe('23:08');
    expect(labels.at(-1)?.getAttribute('text-anchor')).toBe('end');
    expect(labels.some((label) => label.textContent === '22:00')).toBe(false);
    expect(labels.some((label) => label.textContent === '22:59')).toBe(false);
    // Hiding a label must not remove its grid line or failure marker.
    const endpoint = labels.at(-1)!.parentElement!;
    expect(endpoint.previousElementSibling?.querySelector('line')).toBeTruthy();
  });

  it('protects the first endpoint and keeps well-spaced hourly labels', () => {
    const { container } = draw('2026-10-19T12:58:00+08:00', '2026-10-19T23:08:00+08:00');
    const labels = [...container.querySelectorAll('.axis-label')];
    expect(labels[0].textContent).toBe('12:58');
    expect(labels[0].getAttribute('text-anchor')).toBe('start');
    expect(labels.some((label) => label.textContent === '13:00')).toBe(false);
    expect(labels.some((label) => label.textContent === '22:00')).toBe(true);
    expect(labels.some((label) => label.textContent === '23:00')).toBe(false);
    expect(labels.at(-1)?.textContent).toBe('23:08');
  });
});
