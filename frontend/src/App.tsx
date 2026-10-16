import { useEffect, useRef, useState } from 'react';
import { api, ApiError, localInput, stamp } from './api';
import Comparison from './Comparison';
import Gantt from './Gantt';
import type { Simulation, Workbench } from './types';

interface Draft {
  machine_id: string;
  started_at: string;
  recovered_at: string;
  unknown: boolean;
  source: string;
}
const draftFor = (state: Workbench): Draft => ({
  machine_id: state.event.machine_id,
  started_at: localInput(state.event.started_at),
  recovered_at: localInput(
    state.event.recovered_at ||
      new Date(+new Date(state.event.started_at) + 4 * 3600_000).toISOString(),
  ),
  unknown: state.event.recovered_at === null,
  source: state.event.source,
});
const fingerprint = (draft: Draft) =>
  JSON.stringify({ ...draft, recovered_at: draft.unknown ? '' : draft.recovered_at });

export default function App() {
  const [state, setState] = useState<Workbench | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
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
  const decisionRequest = useRef({ key: '', id: '' });

  function accept(value: Workbench) {
    setState(value);
    setDraft(draftFor(value));
    setSimulation(null);
    setReports(null);
    setReason('');
    setSelected('');
    setStale(false);
    setZoom(1);
    setPan(0);
  }

  useEffect(() => {
    let active = true;
    api<Workbench>('/workbench')
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
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作未完成，请重试。');
      if (err instanceof ApiError && err.status === 409) {
        setSimulation(null);
        setReports(null);
        if (
          err.message.includes('更新') ||
          err.message.includes('版本') ||
          err.message.includes('变化')
        )
          setStale(true);
      }
    } finally {
      setBusy('');
    }
  }

  if (!state || !draft)
    return (
      <main className="loading">
        <h1>Schedule Copilot</h1>
        <p role={error ? 'alert' : 'status'}>{error || '正在载入本地车间数据…'}</p>
        {error && (
          <button
            onClick={() => run('载入', async () => accept(await api<Workbench>('/workbench')))}
          >
            重新连接
          </button>
        )}
      </main>
    );

  const dirty = fingerprint(draft) !== fingerprint(draftFor(state));
  const draftInvalid =
    !draft.started_at ||
    !draft.source.trim() ||
    (!draft.unknown && (!draft.recovered_at || draft.recovered_at <= draft.started_at));
  const snapshot = {
    event_revision: state.event_revision,
    baseline_fingerprint: state.baseline.fingerprint,
  };
  const blocked = dirty || stale || !!state.issues.length || !state.event.recovered_at;
  const candidate = simulation?.candidates.find((item) => item.id === selected);
  const currentSimulation =
    simulation &&
    simulation.event_revision === state.event_revision &&
    simulation.baseline_fingerprint === state.baseline.fingerprint &&
    !dirty &&
    !stale
      ? simulation
      : null;
  const allOps = [
    ...state.baseline.operations,
    ...(currentSimulation?.candidates.flatMap((item) => item.schedule.operations) || []),
  ];
  const rangeStart = Math.min(...allOps.map((op) => +new Date(op.start)));
  const rangeEnd = Math.max(
    ...allOps.map((op) => +new Date(op.end)),
    state.event.recovered_at
      ? +new Date(state.event.recovered_at)
      : +new Date(state.event.started_at) + 4 * 3600_000,
  );
  const total = Math.max(3600_000, rangeEnd - rangeStart),
    visible = total / zoom;
  const viewStart = rangeStart + (total - visible) * pan;
  const range: [number, number] = [viewStart, viewStart + visible];
  const originalById = new Map(state.baseline.operations.map((op) => [op.id, op]));
  const affected = state.affected.map((id) => originalById.get(id)!);

  function edit(value: Partial<Draft>) {
    setDraft({ ...draft!, ...value });
    setSimulation(null);
    setReports(null);
    setReason('');
    setNotice('');
  }

  function explain(issue: string) {
    const id = issue.match(/O\d+-OP\d+/)?.[0];
    const op = id && originalById.get(id);
    if (issue.startsWith('报工状态过期') && op)
      return `${id} 原计划在 ${stamp(op.start)} 开工，但13:00快照仍标记为待加工。故障时间晚于这个时点，缺少新的报工状态。请使用13:00模拟，或恢复可试算事件。`;
    if (issue.startsWith('加工中故障') && op)
      return `${op.machine_id} 的故障窗口覆盖了 ${id}（${stamp(op.start)}—${stamp(op.end)}），但执行记录显示它已完成或已开工。请调整故障时间，避免与执行记录冲突。`;
    return issue;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#">
          <span className="brand-mark">SC</span>
          <span>
            Schedule Copilot<small>排产辅助决策工作台</small>
          </span>
        </a>
        <div className="sidebar-section">
          <p className="eyebrow">EVENT INPUT</p>
          <h2>设备故障事件</h2>
          <p className="snapshot-note">
            仿真快照 <strong>{stamp(state.snapshot_time)}</strong>
            <br />
            当前只编辑一条故障，切换设备会替换事件。
          </p>
          <fieldset disabled={!!busy}>
            <label>
              故障设备
              <select
                value={draft.machine_id}
                onChange={(e) => edit({ machine_id: e.target.value })}
              >
                {state.machines.map((machine) => (
                  <option key={machine.id} value={machine.id}>
                    {machine.id} · {machine.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              故障开始时间
              <input
                type="datetime-local"
                value={draft.started_at}
                onChange={(e) => edit({ started_at: e.target.value })}
              />
            </label>
            <button
              className="text-button"
              onClick={() => edit({ started_at: localInput(state.snapshot_time) })}
            >
              使用13:00快照时间
            </button>
            <label className="check-label">
              <input
                type="checkbox"
                checked={draft.unknown}
                onChange={(e) => edit({ unknown: e.target.checked })}
              />
              恢复时间未知
            </label>
            {!draft.unknown && (
              <label>
                预计恢复时间
                <input
                  type="datetime-local"
                  value={draft.recovered_at}
                  onChange={(e) => edit({ recovered_at: e.target.value })}
                />
              </label>
            )}
            {draft.unknown && (
              <p className="hint">暂时只展示潜在风险；补充恢复时间后才能生成正式候选。</p>
            )}
            <label>
              事件来源
              <input
                maxLength={200}
                value={draft.source}
                onChange={(e) => edit({ source: e.target.value })}
                placeholder="例如：维修班组人工估计"
              />
            </label>
            <p className="hint">时间均为 UTC+08:00，恢复时间由人工估计。</p>
            {draftInvalid && (
              <p className="inline-error">请填写开始时间、事件来源，并确保恢复时间晚于开始时间。</p>
            )}
            <button
              className="primary full-width"
              disabled={draftInvalid || stale}
              onClick={() =>
                run('保存事件', async () => {
                  accept(
                    await api<Workbench>(
                      '/event',
                      {
                        ...snapshot,
                        machine_id: draft.machine_id,
                        started_at: `${draft.started_at}:00+08:00`,
                        recovered_at: draft.unknown ? null : `${draft.recovered_at}:00+08:00`,
                        source: draft.source.trim(),
                      },
                      'PUT',
                    ),
                  );
                  setNotice('故障事件已保存。请重新生成候选方案，正式计划未改变。');
                })
              }
            >
              保存故障事件
            </button>
            <button
              className="full-width"
              onClick={() =>
                run('重新载入', async () => {
                  accept(await api<Workbench>('/workbench'));
                  setNotice('已载入后台最新记录，未保存输入已清除。');
                })
              }
            >
              重新载入已保存事件
            </button>
            <button
              className="full-width"
              disabled={stale}
              onClick={() =>
                run('恢复事件', async () => {
                  accept(await api<Workbench>('/event/recover', snapshot));
                  setNotice('已恢复可试算事件。正式计划与历史记录均保留。');
                })
              }
            >
              恢复上次可试算事件
            </button>
          </fieldset>
        </div>
        <div className="sidebar-footer">
          <span className="status-dot" />
          本地仿真 · 人工确认发布
          <br />
          <small>React 界面 / FastAPI 服务</small>
        </div>
      </aside>

      <main className="workspace">
        <header className="page-header">
          <div>
            <p className="eyebrow">PRODUCTION DECISION WORKBENCH</p>
            <h1>故障影响与方案决策</h1>
            <p>先看影响，再比较代价。正式计划由你确认。</p>
          </div>
          <span className="environment-tag">仿真数据 · UTC+08:00</span>
        </header>
        <div aria-live="polite">
          {busy && (
            <div className="message info" role="status">
              正在{busy}…
            </div>
          )}
          {notice && <div className="message success">{notice}</div>}
        </div>
        {error && (
          <div className="message error" role="alert">
            {error}
          </div>
        )}
        {dirty && (
          <div className="message warning">左侧输入尚未保存。旧候选已清除，请先保存再试算。</div>
        )}
        {stale && (
          <div className="message warning">
            后台事件或计划已更新，请点击“重新载入已保存事件”后继续。
          </div>
        )}
        <div className="stat-strip">
          <div>
            <span>{state.event.recovered_at ? '直接受影响工序' : '潜在受影响工序'}</span>
            <strong>
              {state.affected.length}
              <small>道</small>
            </strong>
          </div>
          <div>
            <span>正式计划版本</span>
            <strong>V{state.baseline.version}</strong>
          </div>
          <div>
            <span>已保存事件版本</span>
            <strong>R{state.event_revision}</strong>
          </div>
          <div className="event-stat">
            <span>已保存故障 · {state.event.machine_id}</span>
            <strong>
              {stamp(state.event.started_at)} →{' '}
              {state.event.recovered_at ? stamp(state.event.recovered_at) : '恢复未知'}
            </strong>
            <small>来源：{state.event.source}</small>
          </div>
        </div>

        <section className="section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">CURRENT PLAN</p>
              <h2>当前正式计划</h2>
            </div>
            <div className="chart-controls">
              <label>
                共同缩放
                <input
                  aria-label="甘特图缩放"
                  type="range"
                  min={1}
                  max={4}
                  step={0.25}
                  value={zoom}
                  onChange={(e) => setZoom(+e.target.value)}
                />
              </label>
              <label>
                查看起点
                <input
                  aria-label="甘特图查看起点"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={pan}
                  disabled={zoom === 1}
                  onChange={(e) => setPan(+e.target.value)}
                />
              </label>
            </div>
          </div>
          <Gantt
            schedule={state.baseline}
            failure={state.event}
            machines={state.machines}
            range={range}
          />
          <p className="hint">
            浅色条为已完成工序，红色虚线区域为故障窗口。三个甘特图使用共同时间轴。
          </p>
          <h3 className="block-title">
            {state.event.recovered_at ? '直接影响范围' : '潜在风险范围'}
          </h3>
          {affected.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>工序</th>
                    <th>订单</th>
                    <th>设备</th>
                    <th>原加工时段</th>
                    <th>依据</th>
                  </tr>
                </thead>
                <tbody>
                  {affected.map((op) => (
                    <tr key={op.id}>
                      <th>{op.id}</th>
                      <td>{op.order_id}</td>
                      <td>{op.machine_id}</td>
                      <td>
                        {stamp(op.start)} → {stamp(op.end)}
                      </td>
                      <td>
                        {state.event.recovered_at ? '与故障窗口重叠' : '恢复未知，列为潜在风险'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-state">
              已保存故障未覆盖任何待加工工序，可以试算验证是否需要调整。
            </p>
          )}
        </section>

        <section className="simulation-actions">
          <div>
            <h2>生成候选方案</h2>
            <p>对比“等待修复”与“允许合格设备转移”，不会修改正式计划。</p>
          </div>
          <button
            className="primary"
            disabled={blocked || !!busy}
            onClick={() =>
              run('生成方案', async () => {
                const value = await api<Simulation>('/simulations', snapshot);
                setSimulation(value);
                setSelected(value.candidates[0].id);
                setReports(null);
                setReason('');
              })
            }
          >
            生成候选方案 <span aria-hidden="true">→</span>
          </button>
          {!!state.issues.length && (
            <div className="blockers" role="alert">
              <strong>当前事件与执行记录冲突</strong>
              {state.issues.map((issue) => (
                <p key={issue}>{explain(issue)}</p>
              ))}
              <p>本案例固定在13:00；更改故障时间不会自动推进或回退工序状态。</p>
            </div>
          )}
          {!state.event.recovered_at && (
            <div className="blockers">
              已保存事件的恢复时间未知。请取消左侧“恢复时间未知”，填写恢复时间并保存。
            </div>
          )}
        </section>

        {currentSimulation && (
          <>
            <Comparison state={state} simulation={currentSimulation} range={range} />
            <section className="section ai-section">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">COPILOT ASSIST</p>
                  <h2>AI 辅助分析</h2>
                </div>
                <span className="tag">三个角色 · 只读证据 · 无发布权限</span>
              </div>
              <fieldset disabled={!!busy}>
                <label>
                  向 Copilot 提问
                  <textarea
                    value={question}
                    maxLength={2000}
                    onChange={(e) => {
                      setQuestion(e.target.value);
                      setReports(null);
                    }}
                  />
                </label>
                <div className="inline-actions">
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={live}
                      onChange={(e) => {
                        setLive(e.target.checked);
                        setReports(null);
                      }}
                    />
                    启用 API 多 Agent
                  </label>
                  <button
                    disabled={!question.trim() || blocked}
                    onClick={() =>
                      run('运行分析', async () => {
                        const value = await api<{ reports: Record<string, string> }>('/analysis', {
                          ...snapshot,
                          question,
                          live,
                        });
                        setReports(value.reports);
                      })
                    }
                  >
                    运行分析
                  </button>
                </div>
              </fieldset>
              <p className="hint">
                {live
                  ? '调用后端已配置的模型服务，密钥只保留在后端。'
                  : '当前为离线脚本演示，输出结构化证据，不是大模型推理。'}
              </p>
              {reports && (
                <div className="report-grid">
                  {Object.entries(reports).map(([role, report]) => (
                    <article key={role}>
                      <h3>
                        {{
                          plan_report: '生产计划分析',
                          resource_report: '设备资源分析',
                          decision_report: '方案协调结论',
                        }[role] || role}
                      </h3>
                      <pre>{report}</pre>
                    </article>
                  ))}
                </div>
              )}
            </section>
            <section className="section decision-section">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">HUMAN IN THE LOOP</p>
                  <h2>人工确认</h2>
                </div>
                <span className="tag">当前正式计划 V{state.baseline.version}</span>
              </div>
              <fieldset disabled={!!busy}>
                <div className="decision-fields">
                  <label>
                    本次处理的方案
                    <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                      {currentSimulation.candidates.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    处理方式
                    <select value={action} onChange={(e) => setAction(e.target.value)}>
                      <option value="reject">暂不发布</option>
                      <option value="publish">确认发布</option>
                    </select>
                  </label>
                </div>
                <label>
                  确认理由（必填）
                  <textarea
                    maxLength={2000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="说明选择理由以及接受的代价"
                  />
                </label>
                {action === 'publish' && candidate?.metrics.moved_operations === 0 && (
                  <p className="hint">该方案与当前计划相同，无需重复发布。</p>
                )}
                <div className="inline-actions">
                  <p className="hint">
                    {action === 'publish'
                      ? `将发布“${candidate?.label}”，正式计划更新为 V${state.baseline.version + 1}。`
                      : '只记录人工决定，正式计划保持不变。'}
                  </p>
                  <button
                    className="primary"
                    disabled={
                      !reason.trim() ||
                      blocked ||
                      (action === 'publish' && candidate?.metrics.moved_operations === 0)
                    }
                    onClick={() =>
                      run('提交人工决定', async () => {
                        const key = JSON.stringify([
                          currentSimulation.id,
                          selected,
                          action,
                          reason.trim(),
                        ]);
                        if (decisionRequest.current.key !== key)
                          decisionRequest.current = { key, id: crypto.randomUUID() };
                        const result = await api<{ plan_version: number; workbench: Workbench }>(
                          '/decisions',
                          {
                            simulation_id: currentSimulation.id,
                            candidate_id: selected,
                            action,
                            reason: reason.trim(),
                            request_id: decisionRequest.current.id,
                          },
                        );
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
                      })
                    }
                  >
                    {action === 'publish' ? '确认并发布所选方案' : '记录暂不发布'}
                  </button>
                </div>
              </fieldset>
            </section>
          </>
        )}
        <section className="section">
          <div className="section-heading">
            <h2>人工决定记录</h2>
            <span className="tag">{state.history.length} 条记录</span>
          </div>
          {state.history.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>记录</th>
                    <th>操作</th>
                    <th>理由</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {state.history.map((item) => (
                    <tr key={item.id}>
                      <td>#{item.id}</td>
                      <td>{item.action === 'publish' ? '已发布' : '暂不发布'}</td>
                      <td>{item.reason}</td>
                      <td>{stamp(item.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-state">还没有人工决定。生成并比较方案后，记录你的选择。</p>
          )}
        </section>
        <footer className="workspace-footer">
          Schedule Copilot · 规则排程与约束校验提供计算结果，AI 解释证据，人工决定是否发布。
        </footer>
      </main>
    </div>
  );
}
