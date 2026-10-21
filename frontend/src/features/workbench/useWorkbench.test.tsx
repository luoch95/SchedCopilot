import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowResponse } from '../../shared/api/contracts';
import { simulation, workbench } from '../../test/fixtures';
import { workbenchApi } from './api';
import { useWorkbench } from './useWorkbench';

const saved: WorkflowResponse = {
  workflow: {
    id: 'persisted',
    trace_id: 'TRC-PERSISTED',
    intent: 'generate_candidates',
    status: 'completed',
    failure_code: null,
    trace: [],
    results: {},
    evidence_catalog: {},
  },
  simulation,
};
afterEach(() => vi.restoreAllMocks());

describe('trace recovery', () => {
  it('restores the same trace and candidates on remount without running analysis', async () => {
    vi.spyOn(workbenchApi, 'load').mockResolvedValue(workbench);
    vi.spyOn(workbenchApi, 'latestWorkflow').mockResolvedValue(saved);
    const execute = vi.spyOn(workbenchApi, 'workflow');
    const first = renderHook(() => useWorkbench());
    await waitFor(() => expect(first.result.current.workflow?.trace_id).toBe('TRC-PERSISTED'));
    first.unmount();
    const second = renderHook(() => useWorkbench());
    await waitFor(() => expect(second.result.current.workflow?.trace_id).toBe('TRC-PERSISTED'));
    expect(second.result.current.currentSimulation).toEqual(simulation);
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not overwrite a newly completed analysis with delayed recovery', async () => {
    vi.spyOn(workbenchApi, 'load').mockResolvedValue(workbench);
    let finish!: (response: WorkflowResponse) => void;
    vi.spyOn(workbenchApi, 'latestWorkflow').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const fresh = { ...saved, workflow: { ...saved.workflow, trace_id: 'TRC-NEW' } };
    vi.spyOn(workbenchApi, 'workflow').mockResolvedValue(fresh);
    const hook = renderHook(() => useWorkbench());
    await waitFor(() => expect(workbenchApi.latestWorkflow).toHaveBeenCalled());
    await act(async () => {
      await hook.result.current.generate();
    });
    expect(hook.result.current.workflow?.trace_id).toBe('TRC-NEW');
    await act(async () => {
      finish(saved);
    });
    expect(hook.result.current.workflow?.trace_id).toBe('TRC-NEW');
  });
});
