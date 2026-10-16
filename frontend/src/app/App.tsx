import { AnalysisPanel } from '../features/analysis';
import { Comparison } from '../features/comparison';
import { DecisionPanel } from '../features/decisions';
import { EventEditor, SimulationActions } from '../features/events';
import { DecisionHistory } from '../features/history';
import { CurrentPlan, timelineRange } from '../features/plan';
import { useWorkbench } from '../features/workbench';

/** Composition only. Workflow state and HTTP calls live outside the page. */
export default function App() {
  const controller = useWorkbench();
  const { state, draft, currentSimulation } = controller;
  if (!state || !draft)
    return (
      <main className="loading">
        <h1>Schedule Copilot</h1>
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
            <p className="eyebrow">PRODUCTION DECISION WORKBENCH</p>
            <h1>故障影响与方案决策</h1>
            <p>先看影响，再比较代价。正式计划由你确认。</p>
          </div>
          <span className="environment-tag">仿真数据 · UTC+08:00</span>
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
        />
        {currentSimulation && (
          <>
            <Comparison state={state} simulation={currentSimulation} range={range} />
            <AnalysisPanel
              busy={controller.busy}
              blocked={controller.blocked}
              question={controller.question}
              live={controller.live}
              reports={controller.reports}
              onQuestion={controller.changeQuestion}
              onLive={controller.changeLive}
              onAnalyze={controller.analyze}
            />
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
          </>
        )}
        <DecisionHistory history={state.history} />
        <footer className="workspace-footer">
          Schedule Copilot · 规则排程与约束校验提供计算结果，AI 解释证据，人工决定是否发布。
        </footer>
      </main>
    </div>
  );
}
