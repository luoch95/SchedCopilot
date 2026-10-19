import { PendingRequestsPanel } from '../features/sales';
import { SessionBar } from '../features/session';
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
  const { state, draft, currentSimulation } = controller;
  const roleControl = onSwitchRole && (
    <SessionBar
      role="planner"
      disabled={!!controller.busy}
      onSwitch={() => {
        if (controller.dirty && !window.confirm('未保存的故障输入将丢失，是否切换角色？')) return;
        onSwitchRole();
      }}
    />
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
    <div className="app-shell">
      <EventEditor
        state={state}
        draft={draft}
        busy={controller.busy}
        stale={controller.stale}
        draftInvalid={controller.draftInvalid}
        onEdit={controller.edit}
        onSave={controller.save}
        onReload={controller.reload}
        onRecover={controller.recover}
      />
      <main className="workspace">
        <header className="page-header">
          <div>
            <h1>故障影响与方案决策</h1>
            <p>先看影响，再比较代价。正式计划由你确认。</p>
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
        {controller.error && (
          <div className="message error" role="alert">
            {controller.error}
          </div>
        )}
        {controller.dirty && (
          <div className="message warning">左侧输入尚未保存。旧候选已清除，请先保存再试算。</div>
        )}
        {controller.stale && (
          <div className="message warning">
            后台事件或计划已更新，请点击“重新载入已保存事件”后继续。
          </div>
        )}
        <PendingRequestsPanel
          planner
          onPublished={controller.reload}
          disabled={!!controller.busy || controller.dirty || controller.stale}
        />
        <CurrentPlan
          state={state}
          range={range}
          zoom={controller.zoom}
          pan={controller.pan}
          onZoom={controller.setZoom}
          onPan={controller.setPan}
        />
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
        <footer className="workspace-footer">
          规则排程与约束校验提供计算结果，模型辅助解释证据，人工决定是否发布。
        </footer>
      </main>
    </div>
  );
}
