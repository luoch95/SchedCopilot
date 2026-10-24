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
import { publishedFault, workbenchApi, useHistoricalFaultAnalysis } from '../workbench';
import { FaultAnalysisDetails } from '../analysis';
import { FaultReviewPanel } from './FaultReviewPanel';
import { LeaderFaultAlerts, type FaultEvent } from './LeaderFaultAlerts';
import { WorkbenchTitle } from '../../shared/ui/WorkbenchTitle';
import { DateRangeFilter } from '../../shared/ui/DateRangeFilter';
import { type DateRange } from '../../shared/lib/dateRange';
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
  const [reviewOpen, setReviewOpen] = useState(false);
  const [historicalEvent, setHistoricalEvent] = useState<FaultEvent | null>(null);
  const historical = useHistoricalFaultAnalysis(historicalEvent?.revision);
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
    setReviewOpen(false);
    setAnalysisOpen(false);
    setHistoricalEvent(null);
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
  const analysisWorkflow = publication?.workflow ?? workflow;
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
    <button disabled={loading || busy} onClick={() => setPlanRevision((value) => value + 1)}>
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
            {state && (
              <LeaderFaultAlerts
                state={state}
                workflow={workflow}
                simulation={simulation}
                range={faultRange}
                onAnalysis={() => setAnalysisOpen(true)}
                onReview={() => setReviewOpen(true)}
                onHistory={setHistoricalEvent}
              />
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
      {reviewOpen && state?.fault_review && (
        <Modal drawer busy={busy} title="故障方案审批详情" onClose={() => setReviewOpen(false)}>
          <FaultReviewPanel state={state} onChange={setState} onBusyChange={setBusy} />
        </Modal>
      )}
      {historicalEvent && state && (
        <Modal
          drawer
          drawerWidth="min(1120px, 100vw)"
          title={`${historicalEvent.machine_id}故障 R${historicalEvent.revision} · 历史智能分析明细`}
          onClose={() => setHistoricalEvent(null)}
        >
          {historical.loading ? (
            <p role="status">正在加载历史 AI 分析…</p>
          ) : historical.error ? (
            <p role="alert">{historical.error}</p>
          ) : historical.analysis ? (
            <FaultAnalysisDetails
              state={{
                ...state,
                event: historicalEvent,
                event_revision: historicalEvent.revision,
                baseline: historical.analysis.baseline ?? state.baseline,
                affected: historical.analysis.affected ?? [],
                fault_review: null,
                plan_publication: {
                  version:
                    historical.analysis.published_version ?? historical.analysis.baseline_version,
                  published_at: historical.analysis.published_at ?? null,
                  published_by: null,
                  version_summary: '',
                  fault_analysis: historical.analysis,
                },
              }}
              workflow={historical.analysis.workflow}
              simulation={historical.analysis.simulation}
            />
          ) : (
            <p role="status">该历史修订尚未生成 AI 分析，暂无分析记录。</p>
          )}
        </Modal>
      )}
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
