import { DemoAccessBar, SessionBar } from '../session';
import { useEffect, useState } from 'react';
import type {
  InsertionRequestRecord,
  Simulation,
  Workbench,
  WorkflowResult,
} from '../../shared/api/contracts';
import { Modal } from '../../shared/ui/Modal';
import { CurrentPlan, publishedPlanRange } from '../plan';
import { publishedFault, workbenchApi } from '../workbench';
import { FaultAnalysisDetails, FaultProgress } from '../analysis';
import { FaultReviewPanel } from './FaultReviewPanel';
import { AiAnalysisButton } from '../../shared/ui/AiAnalysisButton';
import { WorkbenchTitle } from '../../shared/ui/WorkbenchTitle';
import { DateRangeFilter } from '../../shared/ui/DateRangeFilter';
import { inDateRange, type DateRange } from '../../shared/lib/dateRange';
import { stamp } from '../../shared/lib/time';
import { WorkshopOverview } from './WorkshopOverview';
import { PendingRequestsPanel } from './PendingRequestsPanel';
import { WeeklyReportButton } from '../admin';

export function LeaderPage({ onSwitchRole }: { onSwitchRole: () => void }) {
  const [selected, setSelected] = useState<InsertionRequestRecord | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<Workbench | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowResult | null>(null);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [planRevision, setPlanRevision] = useState(0);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);
  const [requestRange, setRequestRange] = useState<DateRange>({ start: '', end: '' });
  const [faultRange, setFaultRange] = useState<DateRange>({ start: '', end: '' });
  const [analysisError, setAnalysisError] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setWorkflow(null);
    setSimulation(null);
    setAnalysisError(false);
    void workbenchApi
      .load()
      .then((value) => {
        if (!active) return;
        setState(value);
        return workbenchApi
          .latestWorkflow()
          .then((saved) => {
            if (active) {
              setWorkflow(saved?.workflow ?? null);
              setSimulation(saved?.simulation ?? null);
            }
          })
          .catch(() => {
            if (active) setAnalysisError(true);
          });
      })
      .catch(() => {
        if (active) setError('执行计划读取失败，请重试。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [planRevision]);
  const fault = state?.event_cancelled ? undefined : state?.event;
  const publication = publishedFault(state);
  const analysisWorkflow = workflow ?? publication?.workflow ?? null;
  const step = publication
    ? `调整方案已发布（V${state!.baseline.version}）`
    : state?.fault_review?.status === 'pending'
      ? 'AI评估方案已提交，待管理者审批'
      : state?.fault_review?.status === 'approved'
        ? '管理者已批准，待排产员发布'
        : state?.fault_review?.status === 'rejected'
          ? '管理者已退回，待排产员修改'
          : workflow?.status === 'completed'
            ? 'AI评估方案已成，待提交管理者审批'
            : workflow?.status === 'failed' || workflow?.status === 'blocked'
              ? 'AI分析未完成，待排产员处理'
              : analysisError
                ? '分析记录暂不可用'
                : '故障已保存（待生成方案）';
  const broadcast = [
    fault
      ? `${fault.machine_id} 停机故障 · ${step}`
      : loading
        ? '正在同步设备故障信息'
        : state?.event_cancelled
          ? '误录故障已撤销'
          : '设备故障信息暂不可用',
    'M2 产线有紧急插单需求（演示）',
    '今日整体产线利用率 80%（演示）',
  ].join('　 |　 ');
  const sync = (
    <button disabled={loading} onClick={() => setPlanRevision((value) => value + 1)}>
      同步最新计划
    </button>
  );
  return (
    <main className="sales-workspace leader-workspace leader-dashboard">
      <header className="page-header">
        <div>
          <WorkbenchTitle title="车间运营驾驶舱" english="Workshop Operations Cockpit" />
          <p>掌握车间动态，优先处理审批与异常。</p>
        </div>
        <div className="workbench-identity">
          <SessionBar role="leader" onSwitch={onSwitchRole} disabled={busy} />
        </div>
      </header>
      <DemoAccessBar />
      <section className="leader-ticker" aria-label="车间实时动态">
        <strong>车间动态</strong>
        <div className="leader-ticker-viewport">
          <div className="leader-ticker-track">
            <span>{broadcast}</span>
            <span aria-hidden="true">{broadcast}</span>
          </div>
        </div>
      </section>
      <WorkshopOverview headerActions={<WeeklyReportButton />} />
      <div className="leader-task-grid">
        <PendingRequestsPanel
          leader
          onOpen={setSelected}
          refreshVersion={refresh}
          dateRange={requestRange}
          headerActions={<DateRangeFilter initialRange={requestRange} onChange={setRequestRange} />}
        />
        <section className="dashboard-alerts leader-alerts" aria-label="异常与预警">
          <header className="dashboard-card-heading">
            <h2>异常与预警</h2>
            <div className="inline-actions">
              <DateRangeFilter initialRange={faultRange} onChange={setFaultRange} />
              {sync}
            </div>
          </header>
          <div className="dashboard-alerts-body" tabIndex={0} aria-label="故障与预警内容">
            {error && (
              <div role="alert">
                <p>{error}</p>
              </div>
            )}
            {!state && loading && <p role="status">正在同步车间信息…</p>}
            {fault && inDateRange(fault.started_at, faultRange) && (
              <section className="fault-event-banner" aria-label="已登记设备故障">
                <div className="fault-card-heading">
                  <div className="fault-card-identity">
                    <h2>⚠️ 已登记设备故障：{fault.machine_id} 停机</h2>
                    <p className="fault-analysis-window">
                      分析窗口：{stamp(fault.started_at)} —{' '}
                      {fault.recovered_at ? stamp(fault.recovered_at) : '恢复时间未知'}
                    </p>
                  </div>
                  <div className="fault-task-actions">
                    <div className="ai-analysis-action">
                      <AiAnalysisButton onClick={() => setAnalysisOpen(true)} />
                    </div>
                  </div>
                </div>
                <div className="fault-process-row">
                  <FaultProgress state={state!} workflow={workflow} simulation={simulation} />
                </div>
                {!!fault.recovered_at && !state!.issues.length && (
                  <p className="fault-impact-summary">
                    <strong>
                      结论简要：
                      {publication
                        ? `${publication.affected ? `本次故障原影响 ${publication.affected.length} 道工序；` : ''}发布后当前计划剩余 ${state!.affected.length} 道工序受故障影响。`
                        : `当前计划有 ${state!.affected.length} 道工序受故障影响。`}
                    </strong>
                  </p>
                )}
                <FaultReviewPanel state={state!} onChange={setState} />
              </section>
            )}
            {state?.event_cancelled && (
              <p className="sales-muted">误录故障已撤销，不参与后续排产。</p>
            )}
            {fault && !inDateRange(fault.started_at, faultRange) && (
              <p className="sales-muted">所选时间范围内暂无故障预警。</p>
            )}
          </div>
        </section>
      </div>
      <details
        className="leader-plan-accordion"
        open={planOpen}
        onToggle={(event) => setPlanOpen(event.currentTarget.open)}
      >
        <summary>
          展开查看底层排产执行计划（{state ? `当前版本 V${state.baseline.version}` : '版本待同步'}）
        </summary>
        <div className="leader-plan-content">
          {planOpen &&
            (state ? (
              <section aria-label="生产计划甘特图" aria-busy={loading}>
                <CurrentPlan
                  compact
                  state={state}
                  range={publishedPlanRange(state, zoom, pan)}
                  zoom={zoom}
                  pan={pan}
                  onZoom={setZoom}
                  onPan={setPan}
                  actions={sync}
                />
              </section>
            ) : (
              <p>{error || '正在读取执行计划…'}</p>
            ))}
        </div>
      </details>
      {analysisOpen && state && (
        <Modal
          drawer
          drawerWidth="min(1120px, 100vw)"
          title={`${state.event.machine_id}故障 R${state.event_revision} · 智能分析明细`}
          onClose={() => setAnalysisOpen(false)}
        >
          {analysisError && <p role="alert">分析记录读取失败，请关闭后同步最新计划重试。</p>}
          <FaultAnalysisDetails
            state={state}
            workflow={analysisWorkflow}
            simulation={state.fault_review?.analysis?.simulation ?? simulation}
          />
        </Modal>
      )}
      {selected && (
        <Modal
          drawer
          title="插单审批详情"
          busy={busy}
          onClose={() => {
            setSelected(null);
            setRefresh((value) => value + 1);
          }}
        >
          <p className="console-request-context">
            {selected.request_no} · {selected.product_id} / {selected.quantity} 件
          </p>
          <PendingRequestsPanel leader requestId={selected.request_no} onBusyChange={setBusy} />
        </Modal>
      )}
    </main>
  );
}
