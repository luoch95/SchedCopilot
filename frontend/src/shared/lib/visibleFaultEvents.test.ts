import { describe, expect, it } from 'vitest';
import { workbench } from '../../test/fixtures';
import { faultBusinessLabel, resolveFaultIdentity } from './visibleFaultEvents';

describe('fault business identity', () => {
  const saved = {
    ...workbench.event,
    fault_event_id: 'event-1',
    fault_business_code: 'M1-GZ01',
    fault_process_stage: '004',
    revision: 16,
    created_at: workbench.snapshot_time,
  };
  const state = { ...workbench, event_history: [saved] };

  it('resolves archived identity by stable ID even after the revision changes', () => {
    const archive = { ...workbench.event, fault_event_id: 'event-1' };
    const resolved = resolveFaultIdentity(archive, state, 3);
    expect(faultBusinessLabel(resolved)).toBe('M1-GZ01-004');
    expect(resolved.started_at).toBe(archive.started_at);
    expect(resolved.recovered_at).toBe(archive.recovered_at);
  });

  it('resolves legacy archives only with matching revision, machine and start time', () => {
    expect(resolveFaultIdentity(workbench.event, state, 16).fault_business_code).toBe('M1-GZ01');
    for (const archive of [
      { ...workbench.event, machine_id: 'M2' },
      { ...workbench.event, started_at: '2026-10-26T11:00:00+08:00' },
      { ...workbench.event, fault_event_id: 'another-event' },
    ]) {
      expect(resolveFaultIdentity(archive, state, 16).fault_business_code).toBeUndefined();
    }
    expect(resolveFaultIdentity(workbench.event, state, 15).fault_business_code).toBeUndefined();
  });

  it('reports missing identity without exposing a revision or inventing a sequence', () => {
    expect(faultBusinessLabel({ machine_id: 'M1', revision: 16 })).toBe('M1 · 编号缺失');
  });
});
