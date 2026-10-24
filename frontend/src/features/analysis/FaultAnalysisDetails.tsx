import type { Simulation, Workbench, WorkflowResult } from '../../shared/api/contracts';
import { Comparison } from '../comparison';
import { timelineRange } from '../plan';
import { WorkflowPanel } from './WorkflowPanel';
import { AnalysisPanel } from './AnalysisPanel';
import { ContributionReport } from '../../shared/ui/ContributionReport';
import { useState } from 'react';
import { FaultPlanSwitch } from '../../shared/ui/FaultPlanSwitch';
import { faultPlanStatus, faultVariant, publishedVariant } from '../../shared/lib/faultPlanStatus';
import { TrustScore } from '../../shared/ui/TrustScore';

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
    (!simulation ||
      analysis.simulation?.id === simulation.id ||
      Object.values(analysis.variants ?? {}).some(
        (variant) => variant?.simulation?.id === simulation.id,
      ));
  const reviewed = matches(state.fault_review?.analysis) ? state.fault_review?.analysis : null;
  const published = matches(state.plan_publication?.current_fault_analysis)
    ? state.plan_publication?.current_fault_analysis
    : matches(state.plan_publication?.fault_analysis)
      ? state.plan_publication?.fault_analysis
      : null;
  const root = published ?? reviewed;
  const [choice, setChoice] = useState<{ revision: number; view: 'ai' | 'manual' } | null>(null);
  const view = choice?.revision === state.event_revision ? choice.view : publishedVariant(root);
  const archive = faultVariant(root, view);
  const wasPublished = !!root?.published_version || root?.decisions?.status === 'published';
  const source = archive?.baseline
    ? { ...state, baseline: archive.baseline, affected: archive.affected ?? [] }
    : state;
  // Once an archive is selected, missing fields stay missing. A caller's current
  // workflow or simulation may belong to the other variant.
  const comparison = root ? archive?.simulation : simulation;
  const originalWorkflow = root ? (archive?.workflow ?? null) : workflow;
  const candidate =
    comparison?.candidates.find(
      (item) => item.id === (archive?.selected_candidate_id ?? archive?.decisions?.candidate_id),
    ) ?? (comparison?.candidates.length === 1 ? comparison.candidates[0] : undefined);
  const report = archive?.report ?? originalWorkflow?.contribution_report;
  return (
    <>
      {root && (
        <FaultPlanSwitch
          view={view}
          onChange={(next) => setChoice({ revision: state.event_revision, view: next })}
          hasAi={!!faultVariant(root, 'ai')}
          aiStatus={
            faultVariant(root, 'ai')
              ? faultPlanStatus(
                  faultVariant(root, 'ai')?.simulation,
                  null,
                  faultVariant(root, 'ai'),
                )
              : '原始记录缺失'
          }
          manualStatus={faultPlanStatus(
            faultVariant(root, 'manual')?.simulation,
            null,
            faultVariant(root, 'manual'),
          )}
          hasManual={!!faultVariant(root, 'manual')}
        />
      )}
      {!report && !candidate && <TrustScore result={originalWorkflow} />}
      <ContributionReport
        report={report}
        candidate={candidate}
        result={originalWorkflow}
        published={
          archive?.decisions?.status === 'published' || archive?.published_version !== undefined
        }
      />
      <details>
        <summary>查看审批与发布记录</summary>
        {archive?.decisions && (
          <p>
            审批状态：{faultPlanStatus(archive.simulation, null, archive)}；提交理由：
            {archive.decisions.reason}；审批意见：
            {archive.decisions.review_reason || '尚未审批'}。
          </p>
        )}
        {wasPublished && state.plan_publication && (
          <p>
            发布结果：{publishedVariant(root) === 'manual' ? '人工调整方案' : '原 AI 方案'} ·{' '}
            {root?.published_version
              ? `执行计划 V${root.published_version}`
              : state.plan_publication.version_summary}{' '}
            · {root?.published_at ?? state.plan_publication.published_at ?? '未记录发布时间'}
          </p>
        )}
      </details>
      {!originalWorkflow && <p role="status">暂无完整分析记录，请同步最新数据。</p>}
      {comparison && (
        <Comparison
          state={source}
          simulation={comparison}
          range={timelineRange(source, comparison, 1, 0)}
          workflow={originalWorkflow}
          archived
        />
      )}
      {originalWorkflow && (
        <AnalysisPanel
          simulation={comparison}
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
