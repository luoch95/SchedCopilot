import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../shared/api/errors';
import type {
  CopilotAnswer,
  ManualFaultDraft,
  Simulation,
  SnapshotVersion,
  Workbench,
  WorkflowIntent,
  WorkflowResult,
  WorkflowProgress,
  WorkflowResponse,
} from '../../shared/api/contracts';
import { draftFingerprint, draftFor, type EventDraft } from '../events';
import { workbenchApi } from './api';
import { useDemoAccess } from '../../shared/lib/demoAccess';

/** Own the edit → simulate → compare → human decision lifecycle in one place. */
export function useWorkbench() {
  const { readOnly } = useDemoAccess();
  const [state, setState] = useState<Workbench | null>(null);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [manualDraft, setManualDraft] = useState<ManualFaultDraft | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stale, setStale] = useState(false);
  const [selected, setSelected] = useState('');
  const [reason, setReason] = useState('');
  const [action, setAction] = useState('reject');
  const [answer, setAnswer] = useState<CopilotAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');
  const askingRef = useRef(false);
  const [question, setQuestion] = useState('设备故障后，应该如何比较方案？');
  const [workflow, setWorkflow] = useState<WorkflowResult | null>(null);
  const [activeIntent, setActiveIntent] = useState<WorkflowIntent | null>(null);
  const [progress, setProgress] = useState<WorkflowProgress | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [demoRetryAt, setDemoRetryAt] = useState(0);
  const [demoRemaining, setDemoRemaining] = useState(0);
  const [demoLoading, setDemoLoading] = useState(false);
  const inFlight = useRef(false);
  const workflowAbort = useRef<AbortController | null>(null);
  const decisionRequest = useRef({ key: '', id: '' });
  const recoveryEpoch = useRef(0);
  const initialLoad = useRef<Promise<Workbench> | null>(null);

  useEffect(() => {
    const update = () =>
      setDemoRemaining(Math.max(0, Math.ceil((demoRetryAt - Date.now()) / 1000)));
    update();
    if (!demoRetryAt) return;
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [demoRetryAt]);

  async function toggleDemo(enabled: boolean) {
    if (inFlight.current || demoLoading) return;
    if (!enabled) {
      setDemoEnabled(false);
      return;
    }
    setDemoLoading(true);
    try {
      const status = await workbenchApi.demoStatus();
      setDemoRetryAt(status.retry_at ? Date.parse(status.retry_at) : 0);
      setDemoEnabled(status.available && !inFlight.current);
      if (!status.available) setNotice('兜底演示冷却中，可正常生成候选方案。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法读取演示状态。');
    } finally {
      setDemoLoading(false);
    }
  }

  function clearResults() {
    setAnswer(null);
    setAskError('');
    setManualDraft(null);
    recoveryEpoch.current += 1;
    setSimulation(null);
    setWorkflow(null);
    setProgress(null);
    setReason('');
    setSelected('');
  }

  function accept(value: Workbench) {
    setState(value);
    setDraft(draftFor(value));
    clearResults();
    setStale(false);
    setZoom(1);
    setPan(0);
  }

  function matchesSimulation(value: Workbench, saved: WorkflowResponse) {
    return (
      !value.event_cancelled &&
      (!saved.simulation ||
        (saved.simulation.event_revision === value.event_revision &&
          saved.simulation.baseline_fingerprint === value.baseline.fingerprint))
    );
  }

  useEffect(() => {
    let active = true;
    initialLoad.current ??= workbenchApi.load();
    initialLoad.current
      .then((value) => {
        if (active) {
          accept(value);
          const epoch = recoveryEpoch.current;
          void workbenchApi
            .latestWorkflow()
            .then((saved) => {
              if (
                !active ||
                inFlight.current ||
                epoch !== recoveryEpoch.current ||
                !saved ||
                !matchesSimulation(value, saved)
              )
                return;
              setWorkflow(saved.workflow);
              setSimulation(saved.simulation);
              setSelected(
                value.fault_review && value.fault_review.simulation_id === saved.simulation?.id
                  ? value.fault_review.candidate_id
                  : (saved.simulation?.candidates[0]?.id ?? ''),
              );
            })
            .catch(() => {
              if (active && epoch === recoveryEpoch.current)
                setNotice('历史分析记录未能载入，可重新生成方案。');
            });
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, []);

  async function run(label: string, task: () => Promise<void>) {
    if (readOnly && label !== '重新载入') return false;
    if (inFlight.current) return;
    recoveryEpoch.current += 1;
    inFlight.current = true;
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await task();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作未完成，请重试。');
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        !(label.includes('人工') && err.code === 'rule_violation')
      ) {
        clearResults();
        if (err.code === 'snapshot_conflict' || /更新|版本|变化/.test(err.message)) setStale(true);
      }
      return false;
    } finally {
      inFlight.current = false;
      setBusy('');
    }
  }

  function version(): SnapshotVersion {
    if (!state) throw new Error('请先载入工作台数据');
    return {
      event_revision: state.event_revision,
      baseline_fingerprint: state.baseline.fingerprint,
    };
  }

  const dirty = !!state && !!draft && draftFingerprint(draft) !== draftFingerprint(draftFor(state));
  const draftInvalid =
    !draft ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(draft.started_at) ||
    !draft.source.trim() ||
    (!draft.unknown &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(draft.recovered_at) ||
        draft.recovered_at <= draft.started_at));
  const blocked =
    !state ||
    !!state.event_cancelled ||
    dirty ||
    stale ||
    !!state.issues.length ||
    !state.event.recovered_at;
  const validSimulation =
    simulation &&
    state &&
    !dirty &&
    !stale &&
    simulation.event_revision === state.event_revision &&
    simulation.baseline_fingerprint === state.baseline.fingerprint
      ? simulation
      : null;
  const currentSimulation = manualDraft
    ? manualDraft.status === 'ready_for_review'
      ? manualDraft.simulation
      : null
    : validSimulation;
  const candidate = currentSimulation?.candidates.find((item) => item.id === selected);

  function edit(value: Partial<EventDraft>) {
    if (readOnly || !draft) return;
    setDraft({ ...draft, ...value });
    clearResults();
    setNotice('');
  }

  const reload = () =>
    run('重新载入', async () => {
      const value = await workbenchApi.load();
      accept(value);
      const saved = await workbenchApi.latestWorkflow();
      if (saved && matchesSimulation(value, saved)) {
        setWorkflow(saved.workflow);
        setSimulation(saved.simulation);
        setSelected(
          value.fault_review && value.fault_review.simulation_id === saved.simulation?.id
            ? value.fault_review.candidate_id
            : (saved.simulation?.candidates[0]?.id ?? ''),
        );
      }
      setNotice('已载入后台最新记录，未保存输入已清除。');
    });

  const discardDraft = () => {
    if (state && !inFlight.current) setDraft(draftFor(state));
  };

  const save = () =>
    run('保存事件', async () => {
      if (!draft || draftInvalid || stale) return;
      accept(
        await workbenchApi.saveEvent({
          ...version(),
          machine_id: draft.machine_id,
          started_at: `${draft.started_at}:00+08:00`,
          recovered_at: draft.unknown ? null : `${draft.recovered_at}:00+08:00`,
          source: draft.source.trim(),
        }),
      );
      setNotice('故障事件已保存。请重新生成候选方案，执行计划未改变。');
    });

  const cancelEvent = (revision?: number) =>
    run('撤销误录故障', async () => {
      accept(
        await (revision === undefined
          ? workbenchApi.cancelEvent(version())
          : workbenchApi.cancelEvent(version(), revision)),
      );
      setNotice('故障及关联分析、候选和审批数据已永久删除，不再参与后续排产；已发布计划未改变。');
    });

  const recover = () =>
    run('恢复事件', async () => {
      accept(await workbenchApi.recoverEvent(version()));
      setNotice('已恢复可试算事件。执行计划与历史记录均保留。');
    });

  const runWorkflow = (intent: WorkflowIntent) =>
    run(
      {
        generate_candidates: '生成方案',
        validate: '校验数据',
        re_evaluate: '重新评估',
        explain: '重新解释',
      }[intent],
      async () => {
        if (!state || state.event_cancelled || dirty || stale) return;
        if (intent === 'generate_candidates' && blocked) return;
        if ((intent === 'explain' || intent === 're_evaluate') && !workflow) return;
        if (intent === 'generate_candidates' || intent === 'validate') clearResults();
        if (intent === 're_evaluate' && workflow) {
          setWorkflow({ ...workflow, results: { ...workflow.results, explanation: undefined } });
        }
        setActiveIntent(intent);
        const controller = new AbortController();
        const demonstrate = intent === 'generate_candidates' && demoEnabled;
        workflowAbort.current = controller;
        setProgress({
          intent,
          actions: {
            generate_candidates: ['validate', 'schedule', 'evaluate', 'explain'],
            validate: ['validate'],
            re_evaluate: ['evaluate'],
            explain: ['explain'],
          }[intent] as WorkflowProgress['actions'],
          active: null,
          trace: [],
          results: {},
          interrupted: false,
        });
        try {
          const result = await workbenchApi.workflow(
            {
              ...version(),
              intent,
              ...(demonstrate ? { demo_fallback: true } : {}),
              question: question.trim() || '解释校验结果',
              workflow_id:
                intent === 'explain' || intent === 're_evaluate' ? workflow?.id : undefined,
            },
            (event) =>
              setProgress((previous) => {
                if (!previous) return previous;
                if (event.type === 'trace_started')
                  return { ...previous, trace_id: event.trace_id };
                if (event.type === 'plan') return { ...previous, actions: event.actions };
                if (event.type === 'stage_started')
                  return { ...previous, active: event.action, quality: null };
                if (event.type === 'quality_phase' || event.type === 'quality_checked') {
                  return {
                    ...previous,
                    quality: {
                      action: event.action,
                      round: event.round,
                      phase: event.type === 'quality_phase' ? event.phase : 'checked',
                    },
                  };
                }
                return {
                  ...previous,
                  active: null,
                  quality: null,
                  trace: [...previous.trace, event.step],
                  results: event.report
                    ? { ...previous.results, [event.name]: event.report }
                    : previous.results,
                };
              }),
            controller.signal,
          );
          controller.signal.throwIfAborted();
          if (result.workflow.demo) {
            setDemoRetryAt(
              result.workflow.demo.retry_at ? Date.parse(result.workflow.demo.retry_at) : 0,
            );
          }
          // Refresh the authoritative plan before exposing a completed analysis.
          const latest = await workbenchApi.load();
          controller.signal.throwIfAborted();
          setState(latest);
          setDraft(draftFor(latest));
          if (
            latest.event_revision !== state.event_revision ||
            latest.baseline.fingerprint !== state.baseline.fingerprint ||
            !matchesSimulation(latest, result)
          ) {
            clearResults();
            setNotice('计划或故障已更新，已刷新工作台，请基于最新数据重新评估。');
            return;
          }
          setWorkflow(result.workflow);
          setProgress(null);
          if (result.simulation) {
            setSimulation(result.simulation);
            setSelected(result.simulation.candidates[0]?.id ?? '');
            setReason('');
          }
        } catch (err) {
          setProgress((previous) =>
            previous
              ? {
                  ...previous,
                  active: null,
                  quality: null,
                  interrupted: true,
                  cancelled: controller.signal.aborted,
                }
              : null,
          );
          if (controller.signal.aborted) {
            setNotice('已取消本次执行，未生成新方案。执行计划未改变。');
          } else throw err;
        } finally {
          if (demonstrate) {
            setDemoEnabled(false);
            // The server may have consumed the demo before cancellation.
            void workbenchApi
              .demoStatus()
              .then((status) => {
                setDemoRetryAt(status.retry_at ? Date.parse(status.retry_at) : 0);
              })
              .catch(() => {});
          }
          workflowAbort.current = null;
          setActiveIntent(null);
        }
      },
    );

  const generate = () => runWorkflow('generate_candidates');
  const cancelWorkflow = () => workflowAbort.current?.abort();

  const submitReview = () =>
    run('提交管理者审批', async () => {
      if (
        !manualDraft &&
        workflow?.status === 'completed' &&
        workflow.results.evaluation?.data?.assessment
      ) {
        if (blocked || !reason.trim()) return;
        const key = JSON.stringify(['assessment', workflow.id, reason.trim()]);
        if (decisionRequest.current.key !== key)
          decisionRequest.current = { key, id: crypto.randomUUID() };
        setState(
          await workbenchApi.submitAssessmentReview(
            workflow.id,
            reason.trim(),
            decisionRequest.current.id,
          ),
        );
        setNotice('评估结论已提交管理者审批；审批通过后不产生排产变更。');
        return;
      }
      if (!currentSimulation || !candidate || blocked || !reason.trim()) return;
      const key = JSON.stringify(['review', currentSimulation.id, selected, reason.trim()]);
      if (decisionRequest.current.key !== key)
        decisionRequest.current = { key, id: crypto.randomUUID() };
      setState(
        await workbenchApi.submitFaultReview(
          currentSimulation.id,
          selected,
          reason.trim(),
          decisionRequest.current.id,
        ),
      );
      setNotice('已提交管理者审批，审批通过后可发布；修改方案需重新审批。');
    });

  const decide = () =>
    run('提交人工决定', async () => {
      if (!currentSimulation || !candidate || blocked || !reason.trim()) return;
      if (action === 'publish' && candidate.metrics.moved_operations === 0) return;
      const key = JSON.stringify([currentSimulation.id, selected, action, reason.trim()]);
      if (decisionRequest.current.key !== key)
        decisionRequest.current = { key, id: crypto.randomUUID() };
      const result = await workbenchApi.decide({
        simulation_id: currentSimulation.id,
        candidate_id: selected,
        action: action === 'publish' ? 'publish' : 'reject',
        reason: reason.trim(),
        request_id: decisionRequest.current.id,
      });
      if (action === 'publish') accept(result.workbench);
      else {
        setState(result.workbench);
        setReason('');
      }
      setNotice(
        action === 'publish'
          ? `已发布方案，执行计划版本 V${result.plan_version}。`
          : '已记录暂不发布，执行计划保持不变。',
      );
    });

  async function askQuestion() {
    if (
      !state ||
      !workflow ||
      dirty ||
      stale ||
      state.event_cancelled ||
      busy ||
      askingRef.current ||
      !question.trim()
    )
      return;
    const epoch = recoveryEpoch.current;
    askingRef.current = true;
    setAsking(true);
    setAskError('');
    setAnswer(null);
    try {
      const response = await workbenchApi.ask({
        ...version(),
        workflow_id: workflow.id,
        question: question.trim(),
      });
      if (epoch === recoveryEpoch.current && response.workflow_id === workflow.id)
        setAnswer(response);
    } catch (err) {
      if (epoch === recoveryEpoch.current)
        setAskError(err instanceof Error ? err.message : '解答暂不可用，请重试。');
    } finally {
      askingRef.current = false;
      setAsking(false);
    }
  }

  function changeQuestion(value: string) {
    setQuestion(value);
  }

  useEffect(() => {
    if (!workflow || workflow.status !== 'completed') return;
    let active = true;
    const epoch = recoveryEpoch.current;
    void workbenchApi
      .manualDraft()
      .then((saved) => {
        if (
          !active ||
          inFlight.current ||
          epoch !== recoveryEpoch.current ||
          !saved ||
          saved.event_revision !== state?.event_revision ||
          saved.baseline_fingerprint !== state?.baseline.fingerprint ||
          (saved.workflow_id !== workflow.id &&
            !(
              workflow.intent !== 'generate_candidates' &&
              saved.source_simulation_id &&
              saved.source_simulation_id === simulation?.id
            ))
        )
          return;
        setManualDraft(saved);
        if (saved.simulation) setSelected(saved.simulation.candidates[0]?.id ?? '');
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [workflow?.id, state?.event_revision, state?.baseline.fingerprint]);

  const startManual = () =>
    run('创建人工草案', async () => {
      if (!workflow || workflow.status !== 'completed' || dirty || stale) return;
      const saved = await workbenchApi.createManualDraft(
        workflow.id,
        validSimulation?.id,
        candidate?.id,
      );
      setManualDraft(saved);
      setState(await workbenchApi.load());
      setNotice('已进入人工调整；拖拽只修改草案，确认评估后才能提交审批。');
    });
  const moveManual = (operation_id: string, machine_id: string, start: string, reason: string) =>
    run('保存人工调整', async () => {
      if (!manualDraft || dirty || stale) return;
      const saved = await workbenchApi.saveManualDraft(
        manualDraft.id,
        manualDraft.revision,
        [{ operation_id, machine_id, start }],
        reason,
      );
      setManualDraft(saved);
      setState(await workbenchApi.load());
      setNotice('草案已保存；需确认评估并重新提交审批。');
    });
  const confirmManual = () =>
    run('评估人工草案', async () => {
      if (!manualDraft || dirty || stale) return;
      const saved = await workbenchApi.confirmManualDraft(manualDraft.id, manualDraft.revision);
      setManualDraft(saved);
      setSelected(saved.simulation?.candidates[0]?.id ?? '');
      setReason('');
      setNotice('人工调整草案报告已生成，待提交管理者审批。');
    });

  return {
    manualDraft,
    startManual,
    moveManual,
    confirmManual,
    state,
    draft,
    busy,
    error,
    notice,
    stale,
    dirty,
    draftInvalid,
    blocked,
    currentSimulation,
    selected,
    reason,
    action,
    question,
    answer,
    asking,
    askError,
    askQuestion,
    activeIntent,
    workflow,
    progress,
    runWorkflow,
    candidate,
    zoom,
    pan,
    edit,
    discardDraft,
    reload,
    save,
    recover,
    cancelEvent,
    generate,
    demoEnabled,
    demoRemaining,
    demoLoading,
    toggleDemo,
    cancelWorkflow,
    decide,
    submitReview,
    setSelected,
    setReason,
    setAction,
    changeQuestion,
    setZoom,
    setPan,
  };
}
