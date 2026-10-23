import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkbench } from './useWorkbench';
import { workbenchApi } from './api';
import { workbench, simulation } from '../../test/fixtures';
import type { WorkflowResponse } from '../../shared/api/contracts';

vi.mock('./api', () => ({
  workbenchApi: { load: vi.fn(), latestWorkflow: vi.fn(), workflow: vi.fn() },
}));
const completed: WorkflowResponse = {
  simulation,
  workflow: {
    id: 'current-workflow',
    intent: 'generate_candidates',
    status: 'completed',
    failure_code: null,
    trace: [],
    results: {},
    evidence_catalog: {},
  },
};
afterEach(() => vi.resetAllMocks());

describe('workbench snapshot consistency', () => {
  it('refreshes the execution plan after analysis without publishing the candidate', async () => {
    vi.mocked(workbenchApi.load).mockResolvedValue(workbench);
    vi.mocked(workbenchApi.latestWorkflow).mockResolvedValue(null);
    vi.mocked(workbenchApi.workflow).mockResolvedValue(completed);
    const { result } = renderHook(() => useWorkbench());
    await waitFor(() => expect(result.current.state).not.toBeNull());
    await act(async () => {
      await result.current.generate();
    });
    expect(workbenchApi.load).toHaveBeenCalledTimes(2);
    expect(result.current.workflow?.id).toBe('current-workflow');
    expect(result.current.state?.baseline.version).toBe(1);
    expect(result.current.currentSimulation?.candidates[0].schedule.version).toBe(2);
  });

  it('refreshes a changed server plan and discards results from the old snapshot', async () => {
    const updated = {
      ...workbench,
      baseline: { ...workbench.baseline, version: 2, fingerprint: 'plan-2' },
    };
    vi.mocked(workbenchApi.load).mockResolvedValueOnce(workbench).mockResolvedValue(updated);
    vi.mocked(workbenchApi.latestWorkflow).mockResolvedValue(null);
    vi.mocked(workbenchApi.workflow).mockResolvedValue(completed);
    const { result } = renderHook(() => useWorkbench());
    await waitFor(() => expect(result.current.state).not.toBeNull());
    await act(async () => {
      await result.current.generate();
    });
    expect(result.current.state?.baseline.version).toBe(2);
    expect(result.current.workflow).toBeNull();
    expect(result.current.currentSimulation).toBeNull();
  });

  it('does not restore another fault revision into the active view', async () => {
    vi.mocked(workbenchApi.load).mockResolvedValue(workbench);
    vi.mocked(workbenchApi.latestWorkflow).mockResolvedValue({
      ...completed,
      simulation: { ...simulation, event_revision: 99 },
    });
    const { result } = renderHook(() => useWorkbench());
    await act(async () => {});
    expect(result.current.state).toEqual(workbench);
    expect(result.current.workflow).toBeNull();
    expect(result.current.currentSimulation).toBeNull();
  });
});
