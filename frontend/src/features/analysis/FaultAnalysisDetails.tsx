import type { Simulation, Workbench, WorkflowResult } from '../../shared/api/contracts';
import { Comparison } from '../comparison';
import { timelineRange } from '../plan';
import { WorkflowPanel } from './WorkflowPanel';
import { AnalysisPanel } from './AnalysisPanel';

/** Archived inputs stay separate from the current executable plan. */
export function FaultAnalysisDetails({
  state,
  workflow,
  simulation,
}: {
  state: Workbench;
  workflow: WorkflowResult | null;
  simulation?: Simulation | null;
}) {
  const reviewed =
    !simulation || simulation.id === state.fault_review?.simulation_id
      ? state.fault_review?.analysis
      : null;
  const archive = reviewed ?? state.plan_publication?.fault_analysis;
  const historical = archive?.event_revision === state.event_revision && archive.baseline;
  const source = historical ? { ...state, baseline: historical } : state;
  const comparison = reviewed?.simulation ?? simulation ?? (historical ? archive.simulation : null);
  const originalWorkflow = reviewed?.workflow ?? (historical ? archive.workflow : null) ?? workflow;
  return (
    <>
      {!originalWorkflow && <p role="status">暂无完整分析记录，请同步最新数据。</p>}
      {comparison && (
        <Comparison
          state={source}
          simulation={comparison}
          range={timelineRange(source, comparison, 1, 0)}
          workflow={originalWorkflow}
          archived={!!state.plan_publication?.fault_analysis && !!historical}
        />
      )}
      {originalWorkflow && (
        <AnalysisPanel
          busy=""
          question=""
          result={originalWorkflow}
          readOnly
          onQuestion={() => {}}
          onExplain={() => {}}
        />
      )}
      <WorkflowPanel
        running={false}
        disabled
        result={originalWorkflow}
        expanded
        readOnly
        onRun={() => {}}
      />
    </>
  );
}
