import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
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
