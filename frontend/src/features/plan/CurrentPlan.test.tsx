import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CurrentPlan } from './CurrentPlan';
import { publishedPlanRange } from './model';
import { workbench } from '../../test/fixtures';
import type { Workbench } from '../../shared/api/contracts';

function chart(state: Workbench) {
  return (
    <CurrentPlan
      state={state}
      range={publishedPlanRange(state, 1, 0)}
      zoom={1}
      pan={0}
      onZoom={() => {}}
      onPan={() => {}}
    />
  );
}

it('keeps published fault geometry and chart bounds when a new fault is recorded or cancelled', () => {
  const state: Workbench = {
    ...workbench,
    baseline: { ...workbench.baseline, version: 4 },
    plan_publication: {
      version: 4,
      published_at: null,
      published_by: null,
      version_summary: '已发布',
      fault_traces: [
        { version: 4, event_revision: 1, failure: workbench.event, affected_operations: [] },
      ],
    },
  };
  const view = render(chart(state));
  const original = screen.getByRole('group', { name: `${workbench.event.machine_id} 停机留痕` });
  const geometry = original.querySelector('rect')!.outerHTML;
  const range = publishedPlanRange(state, 1, 0);
  const changed: Workbench = {
    ...state,
    event_revision: 2,
    event: {
      ...state.event,
      machine_id: 'M2',
      started_at: '2026-11-01T08:00:00+08:00',
      recovered_at: '2026-11-01T18:00:00+08:00',
    },
  };
  view.rerender(chart(changed));
  expect(publishedPlanRange(changed, 1, 0)).toEqual(range);
  expect(screen.queryByRole('group', { name: 'M2 停机留痕' })).toBeNull();
  expect(
    screen
      .getByRole('group', { name: `${workbench.event.machine_id} 停机留痕` })
      .querySelector('rect')!.outerHTML,
  ).toBe(geometry);
  fireEvent.focus(original);
  expect(screen.getByRole('tooltip').textContent).toContain('V4 变更留痕');
  view.rerender(chart({ ...changed, event_cancelled: true }));
  expect(
    screen.getByRole('group', { name: `${workbench.event.machine_id} 停机留痕` }),
  ).toBeTruthy();
});

it('does not paint an unpublished fault onto the execution plan', () => {
  render(chart({ ...workbench, plan_publication: undefined }));
  expect(screen.queryByText('⚠ 停机留痕')).toBeNull();
});

it('ignores traces belonging to a different plan version', () => {
  render(
    chart({
      ...workbench,
      plan_publication: {
        version: 99,
        published_at: null,
        published_by: null,
        version_summary: '',
        fault_traces: [
          { version: 99, event_revision: 1, failure: workbench.event, affected_operations: [] },
        ],
      },
    }),
  );
  expect(screen.queryByText('⚠ 停机留痕')).toBeNull();
});

it('locates the execution snapshot without changing operation states or enabling editing', () => {
  render(chart(workbench));
  const marker = document.querySelector('.gantt-time-marker')!;
  expect(marker.textContent).toContain('执行快照 13:00');
  expect(marker.querySelector('line')).toBeTruthy();
  expect(document.querySelector('.gantt-time-boundary')).toBeNull();
  expect(document.querySelector('.gantt-editable-region')).toBeNull();
  const bar = screen.getByRole('graphics-symbol');
  expect(bar.getAttribute('fill')).not.toBe('#F1F5F9');
  fireEvent.focus(bar);
  expect(document.querySelector('.gantt-inspector')?.textContent).toContain('计划中');
});

it('updates current time each minute, keeps the range fixed and cleans up the timer', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-19T13:30:00+08:00'));
  const range = publishedPlanRange(workbench, 1, 0);
  const view = render(chart(workbench));
  try {
    fireEvent.change(screen.getByRole('combobox', { name: '执行计划时间定位' }), {
      target: { value: 'current' },
    });
    const marker = document.querySelector('.gantt-time-marker')!;
    const x = Number(marker.querySelector('line')!.getAttribute('x1'));
    expect(marker.textContent).toContain('当前时间 13:30');
    act(() => vi.advanceTimersByTime(60_000));
    expect(marker.textContent).toContain('当前时间 13:31');
    expect(Number(marker.querySelector('line')!.getAttribute('x1'))).toBeGreaterThan(x);
    vi.setSystemTime(new Date('2026-10-20T13:30:00+08:00'));
    fireEvent(window, new Event('focus'));
    expect(marker.querySelector('line')).toBeNull();
    expect(marker.textContent).toContain('当前时间在显示范围外 →');
    expect(publishedPlanRange(workbench, 1, 0)).toEqual(range);
    fireEvent.change(screen.getByRole('combobox', { name: '执行计划时间定位' }), {
      target: { value: 'snapshot' },
    });
    expect(marker.textContent).toContain('执行快照 13:00');
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.change(screen.getByRole('combobox', { name: '执行计划时间定位' }), {
      target: { value: 'current' },
    });
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});

it('handles missing snapshot times and times before the displayed range without fabricating progress', () => {
  const view = render(chart({ ...workbench, snapshot_time: '' }));
  expect(screen.getByText('执行快照时间缺失，无法定位')).toBeTruthy();
  expect(document.querySelector('.gantt-time-marker')).toBeNull();
  view.rerender(chart({ ...workbench, snapshot_time: '2026-10-18T13:00:00+08:00' }));
  expect(document.querySelector('.gantt-time-marker')?.textContent).toContain(
    '← 执行快照在显示范围外',
  );
  expect(document.querySelector('.gantt-time-marker line')).toBeNull();
});

it('renders published overview traces without operation details and does not infer a transfer result', () => {
  const state: Workbench = {
    ...workbench,
    baseline: { ...workbench.baseline, version: 1, operations: [] },
    affected: [],
    plan_publication: {
      version: 1,
      published_at: null,
      published_by: null,
      version_summary: '已发布',
      fault_traces: [{ version: 1, event_revision: 16, failure: workbench.event }],
    },
  };
  render(chart(state));
  expect(screen.getByRole('heading', { name: '当前执行计划' })).toBeTruthy();
  fireEvent.focus(screen.getByRole('group', { name: `${workbench.event.machine_id} 停机留痕` }));
  const tooltip = screen.getByRole('tooltip');
  expect(tooltip.textContent).toContain('概览未加载受影响工序明细');
  expect(tooltip.textContent).not.toContain('已全部转移');
  expect(tooltip.textContent).not.toContain('已调整避开停机窗口');
});
