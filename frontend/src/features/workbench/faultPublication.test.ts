import { describe, expect, it } from 'vitest';
import { workbench } from '../../test/fixtures';
import { publishedFault, publishedFaultSummary } from './faultPublication';

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

it('recognizes a published overview without restoring archived candidates', () => {
  const state = {
    ...workbench,
    baseline: { ...workbench.baseline, version: 1 },
    plan_publication: {
      version: 1,
      published_at: null,
      published_by: null,
      version_summary: '已发布',
      fault_traces: [
        { version: 1, event_revision: workbench.event_revision, failure: workbench.event },
      ],
    },
  };
  expect(publishedFaultSummary(state)?.published_version).toBe(1);
  expect(publishedFaultSummary(state)?.simulation).toBeUndefined();
  expect(publishedFaultSummary({ ...state, event_revision: 99 })).toBeNull();
  expect(
    publishedFaultSummary({ ...state, event: { ...state.event, fault_event_id: 'another-event' } }),
  ).toBeNull();
});
