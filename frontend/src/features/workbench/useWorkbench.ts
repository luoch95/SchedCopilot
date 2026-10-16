import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../shared/api/errors';
import type { Simulation, SnapshotVersion, Workbench } from '../../shared/api/contracts';
import { draftFingerprint, draftFor, type EventDraft } from '../events';
import { workbenchApi } from './api';

/** Own the edit → simulate → compare → human decision lifecycle in one place. */
export function useWorkbench() {
  const [state, setState] = useState<Workbench | null>(null);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stale, setStale] = useState(false);
  const [selected, setSelected] = useState('');
  const [reason, setReason] = useState('');
  const [action, setAction] = useState('reject');
  const [question, setQuestion] = useState('设备故障后，应该如何比较方案？');
  const [live, setLive] = useState(false);
  const [reports, setReports] = useState<Record<string, string> | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);
  const inFlight = useRef(false);
  const decisionRequest = useRef({ key: '', id: '' });

  function clearResults() {
    setSimulation(null);
    setReports(null);
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

  useEffect(() => {
    let active = true;
    workbenchApi
      .load()
      .then((value) => {
        if (active) accept(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, []);

  async function run(label: string, task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作未完成，请重试。');
      if (err instanceof ApiError && err.status === 409) {
        clearResults();
        if (err.code === 'snapshot_conflict' || /更新|版本|变化/.test(err.message)) setStale(true);
      }
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
    !draft.started_at ||
    !draft.source.trim() ||
    (!draft.unknown && (!draft.recovered_at || draft.recovered_at <= draft.started_at));
  const blocked = !state || dirty || stale || !!state.issues.length || !state.event.recovered_at;
  const currentSimulation =
    simulation &&
    state &&
    !dirty &&
    !stale &&
    simulation.event_revision === state.event_revision &&
    simulation.baseline_fingerprint === state.baseline.fingerprint
      ? simulation
      : null;
  const candidate = currentSimulation?.candidates.find((item) => item.id === selected);

  function edit(value: Partial<EventDraft>) {
    if (!draft) return;
    setDraft({ ...draft, ...value });
    clearResults();
    setNotice('');
  }

  const reload = () =>
    run('重新载入', async () => {
      accept(await workbenchApi.load());
      setNotice('已载入后台最新记录，未保存输入已清除。');
    });

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
      setNotice('故障事件已保存。请重新生成候选方案，正式计划未改变。');
    });

  const recover = () =>
    run('恢复事件', async () => {
      accept(await workbenchApi.recoverEvent(version()));
      setNotice('已恢复可试算事件。正式计划与历史记录均保留。');
    });

  const generate = () =>
    run('生成方案', async () => {
      if (blocked) return;
      const result = await workbenchApi.simulate(version());
      setSimulation(result);
      setSelected(result.candidates[0].id);
      setReports(null);
      setReason('');
    });

  const analyze = () =>
    run('运行分析', async () => {
      if (blocked || !question.trim()) return;
      const result = await workbenchApi.analyze({ ...version(), live, question });
      setReports(result.reports);
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
          ? `已发布方案，正式计划版本 V${result.plan_version}。`
          : '已记录暂不发布，正式计划保持不变。',
      );
    });

  function changeQuestion(value: string) {
    setQuestion(value);
    setReports(null);
  }
  function changeLive(value: boolean) {
    setLive(value);
    setReports(null);
  }

  return {
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
    live,
    reports,
    candidate,
    zoom,
    pan,
    edit,
    reload,
    save,
    recover,
    generate,
    analyze,
    decide,
    setSelected,
    setReason,
    setAction,
    changeQuestion,
    changeLive,
    setZoom,
    setPan,
  };
}
