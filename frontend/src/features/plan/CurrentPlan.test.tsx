import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CurrentPlan } from './CurrentPlan';
import { workbench } from '../../test/fixtures';

it('shows only the active fault overlay while retaining history in the snapshot', () => {
  const state = {
    ...workbench,
    event: { ...workbench.event, machine_id: 'M2' },
    event_revision: 2,
    event_history: [{ ...workbench.event, revision: 1, created_at: workbench.snapshot_time }],
  };
  render(
    <CurrentPlan
      state={state}
      range={[Date.parse(workbench.event.started_at), Date.parse(workbench.event.recovered_at!)]}
      zoom={1}
      pan={0}
      onZoom={() => {}}
      onPan={() => {}}
    />,
  );
  expect(screen.getByRole('group', { name: 'M2 停机留痕' })).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'M1 停机留痕' })).toBeNull();
  expect(state.event_history).toHaveLength(1);
});
