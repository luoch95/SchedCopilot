import type { Simulation, Workbench, WorkflowResult } from '../../shared/api/contracts';
import { Comparison } from '../comparison';
import { timelineRange } from '../plan';
import { WorkflowPanel } from './WorkflowPanel';
import { AnalysisPanel } from './AnalysisPanel';
import { ContributionReport } from '../../shared/ui/ContributionReport';

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
  const matches = (analysis: NonNullable<Workbench['plan_publication']>['fault_analysis']) =>
    analysis?.event_revision === state.event_revision &&
    (!simulation || analysis.simulation?.id === simulation.id);
  const reviewed = matches(state.fault_review?.analysis) ? state.fault_review?.analysis : null;
  const published = matches(state.plan_publication?.fault_analysis)
    ? state.plan_publication?.fault_analysis
    : null;
  const archive = reviewed ?? published;
  const source = archive?.baseline ? { ...state, baseline: archive.baseline } : state;
  const comparison = archive?.simulation ?? simulation;
  const originalWorkflow = archive?.workflow ?? workflow;
  return (
    <>
      <ContributionReport report={archive?.report ?? originalWorkflow?.contribution_report} />
      {archive?.decisions && (
        <p>
          审批状态：{archive.decisions.status}；提交理由：{archive.decisions.reason}；审批意见：
          {archive.decisions.review_reason || '尚未审批'}。
        </p>
      )}
      {published && state.plan_publication && (
        <p>
          发布结果：{state.plan_publication.version_summary} ·{' '}
          {state.plan_publication.published_at ?? '未记录发布时间'}
        </p>
      )}
      {!originalWorkflow && <p role="status">暂无完整分析记录，请同步最新数据。</p>}
      {comparison && (
        <Comparison
          state={source}
          simulation={comparison}
          range={timelineRange(source, comparison, 1, 0)}
          workflow={originalWorkflow}
          archived={!!published}
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
