import {
  faultBusinessLabel,
  resolveFaultIdentity,
  visibleFaultEvents,
} from '../shared/lib/visibleFaultEvents';
import { AiAnalysisButton } from '../shared/ui/AiAnalysisButton';
import { WorkbenchTitle } from '../shared/ui/WorkbenchTitle';
import { FaultPlanPage } from './FaultPlanPage';
import { PublishedFaultCard } from '../shared/ui/PublishedFaultCard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { stamp } from '../shared/lib/time';
import { Modal } from '../shared/ui/Modal';
import { GanttSelectionProvider } from '../shared/ui/GanttSelection';
import type { InsertionRequestRecord, Workbench } from '../shared/api/contracts';
import { PendingRequestsPanel, PlannerInsertionComparison } from '../features/sales';
import {
  DEMO_PLANNER_ID,
  DemoAccessBar,
  SessionBar,
  usePlannerNavigation,
} from '../features/session';
import { FaultAnalysisDetails, FaultProgress } from '../features/analysis';
import { EventEditor, EventIssues } from '../features/events';
import { CurrentPlan, timelineRange, publishedPlanRange } from '../features/plan';
import {
  publishedFaultSummary,
  useWorkbench,
  useHistoricalFaultAnalysis,
} from '../features/workbench';
import { WriteButton } from '../shared/ui/WriteButton';
import { BusinessLabelProvider } from '../shared/lib/BusinessLabelProvider';
import { DateRangeFilter } from '../shared/ui/DateRangeFilter';
import { type DateRange } from '../shared/lib/dateRange';

/** Composition only. Workflow state and HTTP calls live outside the page. */
export default function WorkbenchPage({ onSwitchRole }: { onSwitchRole?: () => void }) {
  const controller = useWorkbench();
  const [dateRange, setDateRange] = useState<DateRange>({ start: '', end: '' });
  const [requestDateRange, setRequestDateRange] = useState<DateRange>({ start: '', end: '' });
  const navigation = usePlannerNavigation();
  const { view, eventOpen, request: selectedRequest, openRequest: navigateRequest } = navigation;
  const [requestRecord, setRequestRecord] = useState<InsertionRequestRecord | null>(null);
  const [requestsVersion, setRequestsVersion] = useState(0);
  const [requestBusy, setRequestBusy] = useState(false);
  const { analysisOpen } = navigation;
  const analysisScroll = useRef(0);
  const [historicalEvent, setHistoricalEvent] = useState<
    NonNullable<Workbench['event_history']>[number] | null
  >(null);
  const historicalAnalysis = useHistoricalFaultAnalysis(historicalEvent?.revision);
  const currentAnalysis = useHistoricalFaultAnalysis(
    analysisOpen && controller.state && !controller.state.event_cancelled
      ? controller.state.event_revision
      : undefined,
  );
  const [notificationReady, setNotificationReady] = useState(true);
  const notificationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generating = controller.activeIntent === 'generate_candidates';
  const publication = publishedFaultSummary(controller.state);
  const analysisWorkflow =
    controller.workflow ?? currentAnalysis.analysis?.workflow ?? publication?.workflow ?? null;
  const assessment =
    analysisWorkflow?.status === 'completed' &&
    analysisWorkflow.results.evaluation?.data?.assessment;
  const generated =
    (!!controller.currentSimulation && controller.workflow?.status === 'completed') ||
    !!publication ||
    !!assessment;
  useEffect(() => {
    if (!generating) return;
    setNotificationReady(false);
    // Navigation and request completion must not restart the demonstration delay.
    clearTimeout(notificationTimer.current);
    notificationTimer.current = setTimeout(() => setNotificationReady(true), 4000);
  }, [generating]);
  useEffect(() => () => clearTimeout(notificationTimer.current), []);
  const backgroundPending = !publication && (generating || (generated && !notificationReady));
  const openRequest = useCallback(
    (record: InsertionRequestRecord) => {
      navigateRequest({
        id: record.id,
        request_no: record.request_no,
        product_id: record.product_id,
        quantity: record.quantity,
      });
      setRequestRecord(record);
    },
    [navigateRequest],
  );
  useEffect(() => {
    if (!selectedRequest) setRequestsVersion((value) => value + 1);
  }, [selectedRequest]);
  function closeEvent() {
    if (controller.busy) return;
    if (controller.dirty && !window.confirm('放弃未保存的故障输入？')) return;
    controller.discardDraft();
    navigation.back();
  }
  async function saveEvent() {
    if (await controller.save()) {
      navigation.back();
      setRequestsVersion((value) => value + 1);
    }
  }
  function analyzeFault() {
    if (controller.busy || controller.blocked || controller.demoLoading) return;
    navigation.openFault();
    void controller.generate();
  }
  const { state, draft, currentSimulation } = controller;
  function switchRole() {
    if (controller.dirty && !window.confirm('未保存的故障输入将丢失，是否切换角色？')) return;
    onSwitchRole?.();
  }
  const roleControl = onSwitchRole && (
    <SessionBar
      role="planner"
      compact={view === 'fault'}
      disabled={!!controller.busy}
      onSwitch={switchRole}
    />
  );
  if (!state || !draft)
    return (
      <main className="loading">
        {roleControl}
        <DemoAccessBar />
        <h1>排产辅助决策工作台</h1>
        <p role={controller.error ? 'alert' : 'status'}>
          {controller.error || '正在载入本地车间数据…'}
        </p>
        {controller.error && <button onClick={controller.reload}>重新连接</button>}
      </main>
    );
  const range = timelineRange(state, currentSimulation, controller.zoom, controller.pan);
  const breadcrumb = (
    <nav className="console-breadcrumb" aria-label="当前位置">
      <ol>
        {onSwitchRole && (
          <li>
            <button disabled={!!controller.busy} onClick={switchRole}>
              选择角色
            </button>
          </li>
        )}
        <li>
          {view === 'fault' ? (
            <button onClick={navigation.home}>工作台总览</button>
          ) : (
            <span aria-current="page">工作台总览</span>
          )}
        </li>
        {view === 'fault' && (
          <li>
            <span aria-current="page">故障影响与方案决策</span>
          </li>
        )}
      </ol>
    </nav>
  );
  const eventLabel = `${faultBusinessLabel({ ...state.event, revision: state.event_revision })}`;
  const publishedCandidate = publication?.simulation?.candidates.find(
    (candidate) =>
      candidate.id === (publication.selected_candidate_id ?? publication.decisions?.candidate_id),
  );
  const analysisTime = analysisWorkflow?.created_at;
  const visibleEvents = visibleFaultEvents(state, dateRange);
  const currentFaultCard = publication ? (
    <PublishedFaultCard
      failure={resolveFaultIdentity(state.event, state, state.event_revision)}

      version={
        publication.published_version ??
        state.plan_publication?.fault_traces?.find(
          (trace) => trace.event_revision === state.event_revision,
        )?.version
      }
      candidateLabel={
        publishedCandidate
          ? publication.selected_variant === 'manual' || publishedCandidate.id.startsWith('manual:')
            ? '人工调整方案'
            : '原 AI 方案'
          : undefined
      }
      metrics={
        publishedCandidate?.metrics ??
        state.plan_publication?.fault_traces?.find(
          (trace) => trace.event_revision === state.event_revision,
        )?.metrics
      }
      orderImpacts={publishedCandidate?.order_impacts}
      label="已登记设备故障"
      onOpen={navigation.openFault}
      onReview={state.fault_review ? navigation.openApproval : undefined}
    />
  ) : (
    <>
      <section className="fault-event-banner" aria-label="已登记设备故障">
        <div className="fault-card-heading">
          <div className="fault-card-identity">
            <h2>
              <span aria-hidden="true">⚠️</span> 已登记设备故障：{state.event.machine_id} 停机
            </h2>
            <p className="fault-analysis-window">
              分析窗口：{stamp(state.event.started_at)} —{' '}
              {state.event.recovered_at ? stamp(state.event.recovered_at) : '预计恢复时间未知'}
            </p>
          </div>
          <div className="fault-task-actions">
            <WriteButton
              className="secondary"
              disabled={!!controller.busy || controller.dirty || controller.stale}
              onClick={() => {
                if (
                  window.confirm(
                    '永久删除这条故障及关联分析、候选、人工草案和审批数据？删除后无法恢复，不再参与后续排产；已发布计划不会回滚。',
                  )
                ) {
                  void controller.cancelEvent();
                }
              }}
            >
              撤销
            </WriteButton>
            {backgroundPending ? (
              <>
                <p role="status" className="fault-task-status">
                  <span className="fault-task-spinner" aria-hidden="true" /> ⏳ 方案生成中...
                </p>
                <button onClick={navigation.openFault}>查看生成进度</button>
              </>
            ) : analysisWorkflow?.status === 'blocked' || assessment ? (
              <AiAnalysisButton label="查看AI评估详情" onClick={navigation.openFault} />
            ) : generated ? (
              <div className="ai-analysis-action">
                <AiAnalysisButton onClick={navigation.openFault} />
                <WriteButton
                  className="secondary"
                  disabled={!!controller.busy || controller.dirty || controller.stale}
                  onClick={() => {
                    navigation.openFault();
                    void controller.generate();
                  }}
                >
                  重新生成方案
                </WriteButton>
              </div>
            ) : (
              <AiAnalysisButton
                label="开始 AI 分析并生成方案"
                write
                disabled={!!controller.busy || controller.blocked || controller.demoLoading}
                onClick={analyzeFault}
              />
            )}
          </div>
        </div>
        <div className="fault-process-row">
          <FaultProgress
            scope="event"
            state={state}
            workflow={controller.workflow}
            simulation={currentSimulation}
            generating={generating}
            dirty={controller.dirty}
            onReview={() => {
              const review = state.fault_review;
              if (
                review &&
                review.event_revision === state.event_revision &&
                review.baseline_fingerprint === state.baseline.fingerprint
              ) {
                if (controller.manualDraft?.simulation?.id === review.simulation_id)
                  controller.switchAnalysis('manual');
                else if (controller.originalSimulation?.id === review.simulation_id)
                  controller.switchAnalysis('ai');
                controller.setSelected(review.candidate_id);
                if (review.status === 'approved') controller.setAction('publish');
              }
              navigation.openApproval();
            }}
          />
        </div>
        <div className="fault-card-details">
          {controller.blocked && (
            <p className="inline-error">
              {controller.dirty
                ? '请先保存或放弃故障输入。'
                : controller.stale
                  ? '请刷新页面获取最新记录后再分析。'
                  : !state.event.recovered_at
                    ? '请补充预计恢复时间并保存后再分析。'
                    : '暂不能分析，具体原因与处理方式见下方。'}
            </p>
          )}
          <EventIssues state={state} />
        </div>
        {!controller.blocked && (
          <p className="fault-impact-summary">
            <strong>结论简要：</strong>
            <strong>{`当前计划有 ${state.affected.length} 道工序受故障影响。`}</strong>
          </p>
        )}
      </section>
    </>
  );
  const currentPlan = (
    <CurrentPlan
      headingLevel={view === 'fault' ? 3 : 2}
      compact
      actions={
        view === 'dashboard' && (
          <div className="console-actions">
            <WriteButton
              className="primary"
              disabled={!!controller.busy}
              onClick={navigation.openEvent}
            >
              + 录入设备故障
            </WriteButton>
          </div>
        )
      }
      state={state}
      range={publishedPlanRange(state, controller.zoom, controller.pan)}
      zoom={controller.zoom}
      pan={controller.pan}
      onZoom={controller.setZoom}
      onPan={controller.setPan}
    />
  );
  return (
    <BusinessLabelProvider
      operations={[
        ...state.baseline.operations,
        ...(currentSimulation?.candidates.flatMap((candidate) => candidate.schedule.operations) ??
          []),
      ]}
    >
      <div
        className={`planner-console${view === 'fault' ? ' fault-decision-layout' : ' dashboard-layout'}`}
      >
        <main className="workspace">
          <div className="planner-topbar">
            {view === 'dashboard' && (
              <header className="page-header">
                <div>
                  <div className="planner-title-row">
                    <WorkbenchTitle />
                    {breadcrumb}
                  </div>
                  <p>
                    {view === 'dashboard'
                      ? '处理插单申请，查看当前已发布的生产安排。'
                      : '分析已保存故障，比较候选方案并确认发布。'}
                  </p>
                </div>
                <div className="workbench-identity">
                  {roleControl}
                  <span className="environment-tag">仿真数据</span>
                </div>
              </header>
            )}
            {view === 'dashboard' && <DemoAccessBar />}
          </div>
          <div className="planner-notifications" aria-live="polite">
            {controller.busy && !(view === 'fault' && generating) && (
              <div className="message info" role="status">
                正在{controller.busy}…
              </div>
            )}
            {controller.notice && <div className="message success">{controller.notice}</div>}
          </div>
          {view === 'fault' && controller.error && !eventOpen && (
            <div className="message error" role="alert">
              {controller.error}
            </div>
          )}
          {view === 'fault' && controller.dirty && (
            <div className="message warning">
              故障输入尚未保存。请打开故障录入窗口保存或放弃修改。
            </div>
          )}
          {view === 'fault' && controller.stale && (
            <div className="message warning">
              后台事件或计划已更新，请刷新页面获取最新记录后继续。
            </div>
          )}
          {view === 'dashboard' ? (
            <>
              <div className="planner-dashboard-grid">
                <aside className="dashboard-summary" aria-label="待办与异常">
                  <PendingRequestsPanel
                    planner
                    assignedPlanner={DEMO_PLANNER_ID}
                    dateRange={requestDateRange}
                    headerActions={
                      <DateRangeFilter
                        initialRange={requestDateRange}
                        onChange={setRequestDateRange}
                      />
                    }
                    onOpen={openRequest}
                    refreshVersion={requestsVersion}
                    disabled={!!controller.busy || controller.dirty || controller.stale}
                  />
                  <section className="dashboard-alerts" aria-labelledby="dashboard-alerts-title">
                    <header className="dashboard-card-heading">
                      <h2 id="dashboard-alerts-title">异常与预警</h2>
                      <DateRangeFilter initialRange={dateRange} onChange={setDateRange} />
                    </header>
                    <div className="dashboard-alerts-body" tabIndex={0} aria-label="故障与预警内容">
                      {controller.error && !eventOpen && (
                        <div className="message error" role="alert">
                          {controller.error}
                        </div>
                      )}
                      {controller.dirty && (
                        <div className="message warning">
                          故障输入尚未保存。请打开故障录入窗口保存或放弃修改。
                        </div>
                      )}
                      {controller.stale && (
                        <div className="message warning">
                          后台事件或计划已更新，请刷新页面获取最新记录后继续。
                        </div>
                      )}
                      {visibleEvents.length === 0 && (
                        <p className="sales-muted">所选时间范围内暂无故障预警。</p>
                      )}
                      {visibleEvents.map((event) => {
                        if (event.revision === state.event_revision)
                          return <div key={event.revision}>{currentFaultCard}</div>;
                        const trace = state.plan_publication?.fault_traces?.find(
                          (item) => item.event_revision === event.revision,
                        );
                        if (
                          !trace &&
                          (event.event_status === 'registered' ||
                            event.event_status === 'pending_approval' ||
                            event.event_status === 'approved')
                        )
                          return (
                            <article
                              key={event.revision}
                              className="fault-event-banner"
                              aria-label={`待处理故障 ${faultBusinessLabel(event)}`}
                            >
                              <div className="fault-card-heading">
                                <div className="fault-card-identity">
                                  <h2>⚠️ 已登记设备故障：{event.machine_id} 停机</h2>
                                  <p className="fault-analysis-window">
                                    分析窗口：{stamp(event.started_at)} —{' '}
                                    {event.recovered_at
                                      ? stamp(event.recovered_at)
                                      : '预计恢复时间未知'}{' '}
                                    · {faultBusinessLabel(event)}
                                  </p>
                                </div>
                                <div className="fault-task-actions">
                                  <WriteButton
                                    className="secondary"
                                    disabled={
                                      !!controller.busy || controller.dirty || controller.stale
                                    }
                                    onClick={() => {
                                      if (
                                        window.confirm(
                                          '确认撤销这条故障及其关联分析、候选和审批数据？',
                                        )
                                      )
                                        void controller.cancelEvent(event.revision);
                                    }}
                                  >
                                    撤销
                                  </WriteButton>
                                  <AiAnalysisButton
                                    label="AI生成评估方案"
                                    onClick={() => setHistoricalEvent(event)}
                                  />
                                </div>
                              </div>
                              <p className="fault-impact-summary">
                                当前状态：
                                {event.event_status === 'pending_approval'
                                  ? '待管理者审批'
                                  : event.event_status === 'approved'
                                    ? '已审批，待发布'
                                    : '故障登记中'}
                              </p>
                            </article>
                          );
                        if (trace)
                          return (
                            <PublishedFaultCard
                              key={event.revision}
                              failure={resolveFaultIdentity(trace.failure, state, event.revision)}

                              version={trace.version}
                              candidateLabel={trace.candidate_label}
                              metrics={trace.metrics}
                              label={`历史故障 ${faultBusinessLabel(event)}`}
                              history
                              onOpen={() => setHistoricalEvent(event)}
                            />
                          );
                        return (
                          <article
                            key={event.revision}
                            className="fault-history-item"
                            aria-label={`历史故障 ${faultBusinessLabel(event)}`}
                          >
                            <h3>
                              {event.machine_id} 停机 · {faultBusinessLabel(event)}
                            </h3>
                            <p>发生时间：{stamp(event.started_at)}</p>
                            <p>
                              分析窗口：{stamp(event.started_at)} —{' '}
                              {event.recovered_at ? stamp(event.recovered_at) : '预计恢复时间未知'}
                            </p>
                            <WriteButton
                              className="secondary"
                              disabled={!!controller.busy || controller.dirty || controller.stale}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    '永久删除这条故障及关联分析、候选、人工草案和审批数据？删除后无法恢复；已发布计划不会回滚。',
                                  )
                                )
                                  void controller.cancelEvent(event.revision);
                              }}
                            >
                              撤销
                            </WriteButton>
                            <AiAnalysisButton
                              label="查看历史 AI 分析"
                              onClick={() => setHistoricalEvent(event)}
                            />
                          </article>
                        );
                      })}
                    </div>
                  </section>
                </aside>
                <div className="dashboard-plan">{currentPlan}</div>
              </div>
            </>
          ) : (
            <>
              <FaultPlanPage
                controller={controller}
                state={state}
                range={range}
                breadcrumb={breadcrumb}
                currentPlan={currentPlan}
                onBack={navigation.home}
                onSwitchRole={onSwitchRole ? switchRole : undefined}
                onBackToAnalysis={navigation.fromAnalysis ? navigation.back : undefined}
                onAdjust={navigation.openEvent}
                showApproval={navigation.approvalOpen}
              />
            </>
          )}
          {view === 'fault' && (
            <footer className="workspace-footer">
              规则排程与约束校验提供计算结果，模型辅助解释证据，人工决定是否发布。
            </footer>
          )}
        </main>
        {analysisOpen && (
          <Modal
            drawer
            drawerWidth="min(1120px, 100vw)"
            title={`${eventLabel} · 智能分析明细`}
            onClose={navigation.back}
            scrollPosition={analysisScroll}
          >
            <div className="fault-analysis-context" aria-label="事件分析标识">
              <span className="fault-analysis-version">
                基线 V{publication?.baseline_version ?? state.baseline.version} ·{' '}
                {faultBusinessLabel(state.event)}
              </span>
              <span>
                {analysisTime && !Number.isNaN(Date.parse(analysisTime))
                  ? `分析于 ${stamp(analysisTime)}`
                  : '分析时间未记录'}
              </span>
            </div>
            {currentAnalysis.loading ? (
              <p role="status">正在加载 AI 分析…</p>
            ) : currentAnalysis.error ? (
              <p role="alert">{currentAnalysis.error}</p>
            ) : (
              <FaultAnalysisDetails
                state={
                  currentAnalysis.analysis
                    ? {
                        ...state,
                        baseline: currentAnalysis.analysis.baseline ?? state.baseline,
                        affected: currentAnalysis.analysis.affected ?? [],
                        plan_publication: {
                          version:
                            currentAnalysis.analysis.published_version ?? state.baseline.version,
                          published_at: currentAnalysis.analysis.published_at ?? null,
                          published_by: null,
                          version_summary: '',
                          fault_analysis: currentAnalysis.analysis,
                        },
                      }
                    : state
                }
                workflow={analysisWorkflow}
                simulation={controller.currentSimulation ?? currentAnalysis.analysis?.simulation}
              />
            )}
            {(analysisWorkflow?.status === 'blocked' || assessment) && (
              <div className="analysis-alert-actions">
                <p className="message warning">
                  {assessment
                    ? '本次评估已完成，可提交管理者审批；如已调整生产条件，可主动重新生成评估。'
                    : '本次评估未生成有效候选。请先查看上方阻断原因，再决定是否重新生成。'}
                </p>
              </div>
            )}
            <div className="assessment-detail-actions">
              {(analysisWorkflow?.status === 'blocked' || assessment) && (
                <WriteButton
                  className="primary"
                  disabled={!!controller.busy || controller.dirty || controller.stale}
                  onClick={() => void controller.generate()}
                >
                  重新生成评估
                </WriteButton>
              )}
              {!publication && analysisWorkflow?.status !== 'blocked' && (
                <button className="primary assessment-submit-link" onClick={navigation.openFault}>
                  查看结果与提交审批
                </button>
              )}
            </div>
          </Modal>
        )}
        {historicalEvent && (
          <Modal
            title={`${faultBusinessLabel(historicalEvent)} · 历史智能分析明细`}
            drawer
            drawerWidth="min(1120px, 100vw)"
            onClose={() => setHistoricalEvent(null)}
          >
            <div className="fault-analysis-context" aria-label="历史事件分析标识">
              <span className="fault-analysis-version">
                {historicalAnalysis.analysis &&
                  `基线 V${historicalAnalysis.analysis.baseline_version} · `}
                {faultBusinessLabel(historicalEvent)}
              </span>
              <span>
                分析窗口：{stamp(historicalEvent.started_at)} —{' '}
                {historicalEvent.recovered_at
                  ? stamp(historicalEvent.recovered_at)
                  : '预计恢复时间未知'}
              </span>
            </div>
            {historicalAnalysis.loading ? (
              <p role="status">正在加载历史 AI 分析…</p>
            ) : historicalAnalysis.error ? (
              <p role="alert">{historicalAnalysis.error}</p>
            ) : historicalAnalysis.analysis ? (
              <FaultAnalysisDetails
                state={{
                  ...state,
                  event: historicalEvent,
                  event_revision: historicalEvent.revision,
                  baseline: historicalAnalysis.analysis.baseline ?? state.baseline,
                  affected: historicalAnalysis.analysis.affected ?? [],
                  fault_review: null,
                  plan_publication: {
                    version:
                      historicalAnalysis.analysis.published_version ??
                      historicalAnalysis.analysis.baseline_version,
                    published_at: historicalAnalysis.analysis.published_at ?? null,
                    published_by: null,
                    version_summary: '',
                    fault_analysis: historicalAnalysis.analysis,
                  },
                }}
                workflow={historicalAnalysis.analysis.workflow}
                simulation={historicalAnalysis.analysis.simulation}
              />
            ) : (
              <p role="status">该历史修订尚未生成 AI 分析，暂无分析记录。</p>
            )}
          </Modal>
        )}
        {eventOpen && (
          <Modal
            drawer
            drawerWidth="min(540px, 100vw)"
            title="录入设备故障"
            onClose={closeEvent}
            busy={!!controller.busy}
          >
            {controller.error && (
              <p role="alert" className="message error">
                {controller.error}
              </p>
            )}
            <EventEditor
              state={state}
              draft={draft}
              busy={controller.busy}
              stale={controller.stale}
              draftInvalid={controller.draftInvalid}
              onEdit={controller.edit}
              onSave={saveEvent}
            />
          </Modal>
        )}
        {selectedRequest && (
          <Modal drawer title="插单影响与方案决策" busy={requestBusy} onClose={navigation.back}>
            <GanttSelectionProvider key={selectedRequest.id}>
              <p className="console-request-context">
                当前申请：{selectedRequest.request_no} · {selectedRequest.product_id} /{' '}
                {selectedRequest.quantity}件
              </p>
              <PendingRequestsPanel
                planner
                requestId={selectedRequest.request_no}
                onRecord={setRequestRecord}
                onBusyChange={setRequestBusy}
                onPublished={() => {
                  void controller.reload();
                  setRequestsVersion((value) => value + 1);
                }}
                disabled={!!controller.busy || controller.dirty || controller.stale}
              />
              {requestRecord?.id === selectedRequest.id && (
                <PlannerInsertionComparison record={requestRecord} state={state} />
              )}
            </GanttSelectionProvider>
          </Modal>
        )}
      </div>
    </BusinessLabelProvider>
  );
}
