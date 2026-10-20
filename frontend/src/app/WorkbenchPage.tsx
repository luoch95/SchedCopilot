import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../shared/ui/Modal';
import { GanttSelectionProvider } from '../shared/ui/GanttSelection';
import type { InsertionRequestRecord } from '../shared/api/contracts';
import { PendingRequestsPanel, PlannerInsertionComparison } from '../features/sales';
import { DEMO_PLANNER_ID, SessionBar, usePlannerNavigation } from '../features/session';
import { AnalysisPanel, WorkflowPanel } from '../features/analysis';
import { Comparison } from '../features/comparison';
import { DecisionPanel } from '../features/decisions';
import { EventEditor, SimulationActions } from '../features/events';
import { DecisionHistory } from '../features/history';
import { CurrentPlan, timelineRange } from '../features/plan';
import { useWorkbench } from '../features/workbench';

/** Composition only. Workflow state and HTTP calls live outside the page. */
export default function WorkbenchPage({ onSwitchRole }: { onSwitchRole?: () => void }) {
  const controller = useWorkbench();
  const navigation = usePlannerNavigation();
  const { view, eventOpen, request: selectedRequest, openRequest: navigateRequest } = navigation;
  const [requestRecord, setRequestRecord] = useState<InsertionRequestRecord | null>(null);
  const [requestsVersion, setRequestsVersion] = useState(0);
  const [requestBusy, setRequestBusy] = useState(false);
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
  const { state, draft, currentSimulation } = controller;
  function switchRole() {
    if (controller.dirty && !window.confirm('未保存的故障输入将丢失，是否切换角色？')) return;
    onSwitchRole?.();
  }
  const roleControl = onSwitchRole && (
    <SessionBar role="planner" disabled={!!controller.busy} onSwitch={switchRole} />
  );
  if (!state || !draft)
    return (
      <main className="loading">
        {roleControl}
        <h1>排产辅助决策工作台</h1>
        <p role={controller.error ? 'alert' : 'status'}>
          {controller.error || '正在载入本地车间数据…'}
        </p>
        {controller.error && <button onClick={controller.reload}>重新连接</button>}
      </main>
    );
  const range = timelineRange(state, currentSimulation, controller.zoom, controller.pan);
  return (
    <div className="planner-console">
      <main className="workspace">
        {view === 'fault' && (
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
                <button disabled={!!controller.busy} onClick={navigation.back}>
                  工作台总览
                </button>
              </li>
              <li>
                <span aria-current="page">故障影响与方案决策</span>
              </li>
            </ol>
          </nav>
        )}
        <header className="page-header">
          <div>
            <h1>{view === 'dashboard' ? '排产计划工作台' : '故障影响与方案决策'}</h1>
            <p>
              {view === 'dashboard'
                ? '处理插单申请，查看当前已发布的生产安排。'
                : '分析已保存故障，比较候选方案并确认发布。'}
            </p>
          </div>
          <div className="workbench-identity">
            {roleControl}
            <span className="environment-tag">仿真数据 · 北京时间</span>
          </div>
        </header>
        <div aria-live="polite">
          {controller.busy && (
            <div className="message info" role="status">
              正在{controller.busy}…
            </div>
          )}
          {controller.notice && <div className="message success">{controller.notice}</div>}
        </div>
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
            后台事件或计划已更新，请点击“重新载入已保存事件”后继续。
          </div>
        )}
        {view === 'dashboard' ? (
          <PendingRequestsPanel
            planner
            assignedPlanner={DEMO_PLANNER_ID}
            onOpen={openRequest}
            refreshVersion={requestsVersion}
            disabled={!!controller.busy || controller.dirty || controller.stale}
          />
        ) : (
          <button className="console-back" disabled={!!controller.busy} onClick={navigation.back}>
            ← 返回工作台总览
          </button>
        )}
        <CurrentPlan
          compact={view === 'dashboard'}
          actions={
            <div className="console-actions">
              <button
                className="primary"
                disabled={!!controller.busy}
                onClick={navigation.openEvent}
              >
                + 录入设备故障
              </button>
              {view === 'dashboard' && (
                <button onClick={navigation.openFault}>故障影响与方案决策</button>
              )}
            </div>
          }
          state={state}
          range={range}
          zoom={controller.zoom}
          pan={controller.pan}
          onZoom={controller.setZoom}
          onPan={controller.setPan}
        />
        {view === 'fault' && (
          <>
            <SimulationActions
              state={state}
              busy={controller.busy}
              blocked={controller.blocked}
              onGenerate={controller.generate}
              onCancel={controller.cancelWorkflow}
              running={controller.activeIntent !== null}
              demoEnabled={controller.demoEnabled}
              demoRemaining={controller.demoRemaining}
              demoLoading={controller.demoLoading}
              onDemoChange={controller.toggleDemo}
            />
            <WorkflowPanel
              running={controller.activeIntent !== null}
              disabled={!!controller.busy || controller.dirty || controller.stale}
              result={controller.workflow}
              progress={controller.progress}
              onRun={controller.runWorkflow}
            />
            {currentSimulation && (
              <Comparison
                state={state}
                simulation={currentSimulation}
                range={range}
                workflow={controller.workflow}
              />
            )}
            {controller.workflow && (
              <AnalysisPanel
                busy={controller.busy}
                question={controller.question}
                result={controller.workflow}
                onQuestion={controller.changeQuestion}
                onExplain={() => controller.runWorkflow('explain')}
              />
            )}
            {currentSimulation && (
              <DecisionPanel
                state={state}
                currentSimulation={currentSimulation}
                candidate={controller.candidate}
                busy={controller.busy}
                blocked={controller.blocked}
                selected={controller.selected}
                reason={controller.reason}
                action={controller.action}
                onSelected={controller.setSelected}
                onReason={controller.setReason}
                onAction={controller.setAction}
                onDecide={controller.decide}
              />
            )}
            <DecisionHistory history={state.history} />
          </>
        )}
        <footer className="workspace-footer">
          规则排程与约束校验提供计算结果，模型辅助解释证据，人工决定是否发布。
        </footer>
      </main>
      {eventOpen && (
        <Modal title="录入设备故障" onClose={closeEvent} busy={!!controller.busy}>
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
  );
}
