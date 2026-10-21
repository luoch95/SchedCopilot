import { AiAnalysisButton } from '../shared/ui/AiAnalysisButton';
import { WorkbenchTitle } from '../shared/ui/WorkbenchTitle';
import { FaultPlanPage } from './FaultPlanPage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { stamp } from '../shared/lib/time';
import { Modal } from '../shared/ui/Modal';
import { GanttSelectionProvider } from '../shared/ui/GanttSelection';
import type { InsertionRequestRecord } from '../shared/api/contracts';
import { PendingRequestsPanel, PlannerInsertionComparison } from '../features/sales';
import {
  DEMO_PLANNER_ID,
  DemoAccessBar,
  SessionBar,
  usePlannerNavigation,
} from '../features/session';
import { WorkflowPanel } from '../features/analysis';
import { EventEditor } from '../features/events';
import { CurrentPlan, timelineRange } from '../features/plan';
import { useWorkbench } from '../features/workbench';
import { WriteButton } from '../shared/ui/WriteButton';
import { BusinessLabelProvider } from '../shared/lib/BusinessLabelProvider';
import { DateRangeFilter } from '../shared/ui/DateRangeFilter';
import { inDateRange, newestFirst, type DateRange } from '../shared/lib/dateRange';

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
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [notificationReady, setNotificationReady] = useState(true);
  const notificationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generating = controller.activeIntent === 'generate_candidates';
  const generated = !!controller.currentSimulation && controller.workflow?.status === 'completed';
  useEffect(() => {
    if (!generating) return;
    setNotificationReady(false);
    // Navigation and request completion must not restart the demonstration delay.
    clearTimeout(notificationTimer.current);
    notificationTimer.current = setTimeout(() => setNotificationReady(true), 4000);
  }, [generating]);
  useEffect(() => () => clearTimeout(notificationTimer.current), []);
  const backgroundPending = generating || (generated && !notificationReady);
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
  const eventLabel = `${state.event.machine_id}故障 R${state.event_revision}`;
  const analysisTime = controller.workflow?.created_at;
  const visibleEvents = [
    ...(state.event_history ?? []).filter((event) => event.revision !== state.event_revision),
    { ...state.event, revision: state.event_revision, created_at: state.event.received_at },
  ]
    .filter((event) => inDateRange(event.started_at, dateRange))
    .sort((a, b) => newestFirst(a.started_at, b.started_at) || b.revision - a.revision);
  const currentFaultCard = (
    <>
      <section className="fault-event-banner" aria-label="已登记设备故障">
        <div className="fault-card-heading">
          <h2>
            <span aria-hidden="true">⚠️</span> 已登记设备故障：
            {state.event.machine_id} 停机
          </h2>
          <div className="fault-task-actions">
            {backgroundPending ? (
              <>
                <p role="status" className="fault-task-status">
                  <span className="fault-task-spinner" aria-hidden="true" /> ⏳ 方案生成中...
                </p>
                <button onClick={navigation.openFault}>查看生成进度</button>
              </>
            ) : generated ? (
              <div className="ai-analysis-action">
                <AiAnalysisButton onClick={() => setAnalysisOpen(true)} />
              </div>
            ) : (
              <WriteButton
                className="primary"
                disabled={!!controller.busy || controller.blocked || controller.demoLoading}
                onClick={analyzeFault}
              >
                分析影响并生成候选方案
              </WriteButton>
            )}
          </div>
        </div>
        <div className="fault-card-details">
          <p>
            分析窗口：{stamp(state.event.started_at)} —{' '}
            {state.event.recovered_at ? stamp(state.event.recovered_at) : '恢复时间未知'}
          </p>
          <p className="workflow-current-step">
            当前步骤：
            {controller.dirty
              ? '故障录入（修改尚未保存）'
              : generating
                ? '方案正在由AI分析'
                : generated
                  ? 'AI评估方案已成，待排产员发布'
                  : '故障已保存（待生成方案）'}
          </p>
          {controller.blocked && (
            <p className="inline-error">
              {controller.dirty
                ? '请先保存或放弃故障输入。'
                : controller.stale
                  ? '请重新载入已保存事件后再分析。'
                  : !state.event.recovered_at
                    ? '请补充预计恢复时间并保存后再分析。'
                    : '事件与执行记录冲突，请修正故障信息后再分析。'}
            </p>
          )}
        </div>
        <p className="fault-impact-summary">
          <strong>结论简要：</strong>
          <strong>当前计划有 {state.affected.length} 道工序受故障影响。</strong>
        </p>
      </section>
    </>
  );
  const currentPlan = (
    <CurrentPlan
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
      range={range}
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
            <div className="planner-navigation-row">
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
                      <button onClick={navigation.back}>工作台总览</button>
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
            </div>
            {view === 'dashboard' && (
              <header className="page-header">
                <div>
                  <WorkbenchTitle />
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
            <DemoAccessBar />
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
              后台事件或计划已更新，请点击“重新载入已保存事件”后继续。
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
                          后台事件或计划已更新，请重新载入已保存事件后继续。
                        </div>
                      )}
                      {visibleEvents.length === 0 && (
                        <p className="sales-muted">所选时间范围内暂无故障预警。</p>
                      )}
                      {visibleEvents.map((event) =>
                        event.revision === state.event_revision ? (
                          <div key={event.revision}>{currentFaultCard}</div>
                        ) : (
                          <article
                            key={event.revision}
                            className="fault-history-item"
                            aria-label={`历史故障 ${event.machine_id} R${event.revision}`}
                          >
                            <h3>
                              {event.machine_id} 停机 · R{event.revision}
                            </h3>
                            <p>发生时间：{stamp(event.started_at)}</p>
                            <p>
                              分析窗口：{stamp(event.started_at)} —{' '}
                              {event.recovered_at ? stamp(event.recovered_at) : '恢复时间未知'}
                            </p>
                            <span className="tag">历史修订 · 仅供查看</span>
                          </article>
                        ),
                      )}
                    </div>
                  </section>
                </aside>
                <div className="dashboard-plan">{currentPlan}</div>
              </div>
            </>
          ) : (
            <>
              <button className="console-back primary" onClick={navigation.back}>
                ← 返回工作台总览
              </button>
              <FaultPlanPage
                controller={controller}
                state={state}
                range={range}
                currentPlan={currentPlan}
                roleControl={roleControl}
                onAdjust={navigation.openEvent}
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
            onClose={() => setAnalysisOpen(false)}
          >
            <div className="fault-analysis-context" aria-label="事件分析标识">
              <span className="fault-analysis-version">
                基线 V{state.baseline.version} · 故障 R{state.event_revision}
              </span>
              <span>
                {analysisTime && !Number.isNaN(Date.parse(analysisTime))
                  ? `分析于 ${stamp(analysisTime)}`
                  : '分析时间未记录'}
              </span>
            </div>
            <WorkflowPanel
              running={controller.activeIntent !== null}
              disabled={!!controller.busy || controller.dirty || controller.stale}
              result={controller.workflow}
              progress={controller.progress}
              onRun={controller.runWorkflow}
            />
            <button
              className="primary"
              onClick={() => {
                setAnalysisOpen(false);
                navigation.openFault();
              }}
            >
              查看方案对比与发布
            </button>
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
              onReload={controller.reload}
              onRecover={controller.recover}
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
