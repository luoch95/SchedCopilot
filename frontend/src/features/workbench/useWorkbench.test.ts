import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkbench } from './useWorkbench';
import { workbenchApi } from './api';
import { workbench, simulation } from '../../test/fixtures';
import { ApiError } from '../../shared/api/errors';
import type { ManualFaultDraft, WorkflowResponse } from '../../shared/api/contracts';

vi.mock('./api', () => ({
  workbenchApi: {
    load: vi.fn(),
    ask: vi.fn(),
    cancelEvent: vi.fn(),
    latestWorkflow: vi.fn(),
    workflow: vi.fn(),
    manualDraft: vi.fn().mockResolvedValue(null),
    createManualDraft: vi.fn(),
    saveManualDraft: vi.fn(),
    confirmManualDraft: vi.fn(),
    evaluateManualDraft: vi.fn(),
  },
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
    vi.mocked(workbenchApi.manualDraft).mockResolvedValue(null);
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

const manualDraft: ManualFaultDraft = {
  id: 'draft-1',
  revision: 1,
  status: 'editing',
  workflow_id: completed.workflow.id,
  source_candidate_id: null,
  source_simulation_id: null,
  event_revision: workbench.event_revision,
  baseline_fingerprint: workbench.baseline.fingerprint,
  schedule: workbench.baseline,
  origin: workbench.baseline,
  edits: [],
  issues: [],
  report: null,
  simulation: null,
};

it('preserves the editable draft when confirmation finds a repairable constraint conflict', async () => {
  vi.mocked(workbenchApi.load).mockResolvedValue(workbench);
  vi.mocked(workbenchApi.latestWorkflow).mockResolvedValue(completed);
  vi.mocked(workbenchApi.manualDraft).mockResolvedValue(manualDraft);
  vi.mocked(workbenchApi.saveManualDraft).mockResolvedValue(manualDraft);
  vi.mocked(workbenchApi.evaluateManualDraft).mockRejectedValue(
    new ApiError('resource conflict', 409, 'rule_violation'),
  );
  const { result } = renderHook(() => useWorkbench());
  await waitFor(() => expect(result.current.manualDraft?.id).toBe('draft-1'));
  await act(async () => {
    await result.current.confirmManual();
  });
  expect(result.current.manualDraft).toEqual(manualDraft);
  expect(result.current.error).toBe('resource conflict');
  expect(result.current.stale).toBe(false);
});

it('does not restore an old manual draft over a new analysis of the same snapshot', async () => {
  vi.mocked(workbenchApi.load).mockResolvedValue(workbench);
  vi.mocked(workbenchApi.latestWorkflow).mockResolvedValue(completed);
  vi.mocked(workbenchApi.manualDraft).mockResolvedValue(manualDraft);
  vi.mocked(workbenchApi.workflow).mockResolvedValue({
    ...completed,
    workflow: { ...completed.workflow, id: 'new-analysis' },
  });
  const { result } = renderHook(() => useWorkbench());
  await waitFor(() => expect(result.current.manualDraft?.id).toBe('draft-1'));
  await act(async () => {
    await result.current.generate();
  });
  await waitFor(() => expect(result.current.workflow?.id).toBe('new-analysis'));
  expect(result.current.manualDraft).toBeNull();
});

it('cancels an incorrectly recorded fault and clears its old decision results', async () => {
  vi.mocked(workbenchApi.manualDraft).mockResolvedValue(null);
  vi.mocked(workbenchApi.load).mockResolvedValue(workbench);
  vi.mocked(workbenchApi.latestWorkflow).mockResolvedValue(completed);
  vi.mocked(workbenchApi.cancelEvent).mockResolvedValue({
    ...workbench,
    event_cancelled: true,
    event_revision: workbench.event_revision + 1,
    affected: [],
    issues: [],
  });
  const { result } = renderHook(() => useWorkbench());
  await waitFor(() => expect(result.current.workflow).not.toBeNull());
  await act(async () => {
    await result.current.cancelEvent();
  });
  expect(workbenchApi.cancelEvent).toHaveBeenCalledWith({
    event_revision: workbench.event_revision,
    baseline_fingerprint: workbench.baseline.fingerprint,
  });
  expect(result.current.state?.event_cancelled).toBe(true);
  expect(result.current.state?.baseline).toEqual(workbench.baseline);
  expect(result.current.blocked).toBe(true);
  expect(result.current.workflow).toBeNull();
  expect(result.current.currentSimulation).toBeNull();
});

it('deletes a historical fault using the current snapshot token', async () => {
  vi.mocked(workbenchApi.load).mockResolvedValue(workbench);
  vi.mocked(workbenchApi.latestWorkflow).mockResolvedValue(null);
  vi.mocked(workbenchApi.cancelEvent).mockResolvedValue(workbench);
  const { result } = renderHook(() => useWorkbench());
  await waitFor(() => expect(result.current.state).not.toBeNull());
  await act(async () => {
    await result.current.cancelEvent(42);
  });
  expect(workbenchApi.cancelEvent).toHaveBeenCalledWith(
    {
      event_revision: workbench.event_revision,
      baseline_fingerprint: workbench.baseline.fingerprint,
    },
    42,
  );
  expect(result.current.notice).toContain('永久删除');
});

it('discards an in-flight answer when fault inputs change and preserves candidate results during QA', async () => {
  vi.mocked(workbenchApi.load).mockResolvedValue(workbench);
  vi.mocked(workbenchApi.latestWorkflow).mockResolvedValue(completed);
  vi.mocked(workbenchApi.manualDraft).mockResolvedValue(null);
  let finish!: (value: Awaited<ReturnType<typeof workbenchApi.ask>>) => void;
  vi.mocked(workbenchApi.ask).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result } = renderHook(() => useWorkbench());
  await waitFor(() => expect(result.current.workflow?.id).toBe('current-workflow'));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.askQuestion();
  });
  expect(result.current.asking).toBe(true);
  expect(result.current.workflow).toEqual(completed.workflow);
  expect(result.current.currentSimulation).toEqual(simulation);
  act(() => result.current.edit({ source: '修改现场信息' }));
  await act(async () => {
    finish({
      workflow_id: 'current-workflow',
      question: '旧问题',
      answer: '旧回答',
      mode: 'fallback',
      execution: { calls: 0, error_code: null },
      knowledge: { status: 'no_match', message: '', sources: [] },
    });
    await pending;
  });
  expect(result.current.answer).toBeNull();
  expect(workbenchApi.workflow).not.toHaveBeenCalled();
});
