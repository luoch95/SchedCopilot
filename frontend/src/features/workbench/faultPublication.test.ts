import { describe, expect, it } from 'vitest';
import { workbench } from '../../test/fixtures';
import { publishedFault } from './faultPublication';

describe('published fault provenance', () => {
  const state = {
    ...workbench,
    baseline: { ...workbench.baseline, version: 4 },
    affected: [],
    plan_publication: {
      version: 4,
      published_at: '2026-10-19T06:00:00Z',
      published_by: 'planner_01',
      version_summary: '故障调整',
      fault_analysis: {
        event_revision: workbench.event_revision,
        baseline_version: 3,
        affected: workbench.affected,
        workflow: null,
      },
    },
  };
  it('uses published evidence only for the same formal version and saved fault', () => {
    expect(publishedFault(state)?.affected).toEqual(workbench.affected);
    expect(publishedFault({ ...state, event_revision: state.event_revision + 1 })).toBeNull();
    expect(publishedFault({ ...state, baseline: { ...state.baseline, version: 5 } })).toBeNull();
    expect(publishedFault(workbench)).toBeNull();
  });
});
