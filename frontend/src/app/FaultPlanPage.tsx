import { DecisionPageHeader } from '../shared/ui/DecisionPageHeader';
import { ManualPlanBreadcrumb } from '../shared/ui/ManualPlanBreadcrumb';
import { FaultPlanOutline } from './FaultPlanOutline';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { Workbench } from '../shared/api/contracts';
import { FaultDecisionEvidence } from './FaultDecisionEvidence';
import { Comparison, MetricsTable, planConclusion } from '../features/comparison';
import { DecisionPanel } from '../features/decisions';
import { SimulationActions } from '../features/events';
import { DecisionHistory } from '../features/history';
import type { useWorkbench } from '../features/workbench';
import { publishedFault, ManualFaultPanel, ManualBasisPicker } from '../features/workbench';
import { ContributionReport } from '../shared/ui/ContributionReport';
import { DecisionText } from '../shared/ui/DecisionText';
import { WriteButton } from '../shared/ui/WriteButton';
import { TraceBadge } from '../shared/ui/TraceTree';
import { GenerationLoading } from '../shared/ui/GenerationLoading';
import { stamp } from '../shared/lib/time';
import { TrustScore } from '../shared/ui/TrustScore';
import { FaultPlanSwitch } from '../shared/ui/FaultPlanSwitch';
import { faultPlanStatus, faultVariant, publishedVariant } from '../shared/lib/faultPlanStatus';
import { WorkflowPanel } from '../features/analysis';
import { candidateTitle, changedOperationCount } from '../shared/lib/candidatePresentation';

interface Props {
  controller: ReturnType<typeof useWorkbench>;
  state: Workbench;
  range: [number, number];
  currentPlan: ReactNode;
  breadcrumb?: ReactNode;
  onBack: () => void;
  onSwitchRole?: () => void;
  onBackToAnalysis?: () => void;
  onAdjust: () => void;
  showApproval?: boolean;
}

export function FaultPlanPage({
  controller,
  state,
  range,
  currentPlan,
  breadcrumb,
  onBack,
  onSwitchRole,
  onBackToAnalysis,
  onAdjust,
  showApproval = false,
}: Props) {
  const approvalRef = useRef<HTMLElement>(null);
  const [adopted, setAdopted] = useState('');
  const [activeTab, setActiveTab] = useState('section-operations');
  const [choosingBasis, setChoosingBasis] = useState(false);
  const [basisSelection, setBasisSelection] = useState<string | null | undefined>(undefined);
  const [basisAcknowledged, setBasisAcknowledged] = useState(false);
  const [archiveChoice, setArchiveChoice] = useState<{
    revision: number;
    view: 'ai' | 'manual';
  } | null>(null);
  const cancelEditor = () => {
    setBasisSelection(controller.manualEditor?.source_candidate_id ?? null);
    controller.cancelManual();
    setChoosingBasis(true);
  };
  const openBasisPicker = () => {
    setBasisSelection(undefined);
    setBasisAcknowledged(false);
    setChoosingBasis(true);
  };
  const exitManual = (navigate?: () => void) => {
    controller.cancelManual();
    setChoosingBasis(false);
    navigate?.();
  };
  const manualBreadcrumb = (editing: boolean) => (
    <ManualPlanBreadcrumb
      editing={editing}
      disabled={!!controller.busy}
      onRole={onSwitchRole ? () => exitManual(onSwitchRole) : undefined}
      onHome={() => exitManual(onBack)}
      onDecision={() => exitManual()}
      onBasis={cancelEditor}
    />
  );
  const [comparisonChoice, setComparisonChoice] = useState<{
    manualId: string;
    id: string | null;
  } | null>(null);
  useEffect(() => {
    if (!showApproval) return;
    approvalRef.current?.scrollIntoView?.({ block: 'start' });
    approvalRef.current?.focus({ preventScroll: true });
  }, [showApproval, state.fault_review?.id]);
  const { currentSimulation } = controller;
  const publication = publishedFault(state);
  const published = !!publication;
  const archiveView =
    archiveChoice?.revision === state.event_revision
      ? archiveChoice.view
      : publishedVariant(publication);
  const archive = faultVariant(publication, archiveView);
  const manualView = published ? archiveView === 'manual' : controller.analysisView === 'manual';
  const activeManual = controller.activeManual;
  const generating =
    controller.activeIntent === 'generate_candidates' &&
    (controller.busy !== '评估人工草案' || manualView);
  const hasCandidates = !!currentSimulation?.candidates.length && !generating;
  const assessment =
    !generating && controller.workflow?.status === 'completed'
      ? controller.workflow.results.evaluation?.data?.assessment
      : null;
  const assessmentReview =
    assessment && state.fault_review?.workflow_id === controller.workflow?.id
      ? state.fault_review
      : null;
  const presentCandidate = (
    candidate: NonNullable<typeof currentSimulation>['candidates'][number],
  ) => ({
    ...candidate,
    label: candidateTitle(candidate, controller.originalWorkflow, controller.workflow),
  });
  const conclusion = planConclusion(
    currentSimulation?.candidates.map(presentCandidate) ?? [],
    controller.workflow,
  );

  const review =
    state.fault_review?.simulation_id === currentSimulation?.id ? state.fault_review : null;
  const analysisTrace = controller.activeIntent
    ? controller.progress?.trace_id
    : controller.workflow?.trace_id;
  const generationControls = (
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
      workflow={controller.workflow}
    />
  );
  const decisionPanel = currentSimulation &&
    (adopted === currentSimulation.id || activeManual?.status === 'ready_for_review' || review) && (
      <DecisionPanel
        embedded
        state={state}
        currentSimulation={{
          ...currentSimulation,
          candidates: currentSimulation.candidates.map(presentCandidate),
        }}
        candidate={controller.candidate ? presentCandidate(controller.candidate) : undefined}
        busy={controller.busy}
        blocked={controller.blocked}
        selected={controller.selected}
        reason={controller.reason}
        action={controller.action}
        onSelected={controller.setSelected}
        onReason={controller.setReason}
        onAction={controller.setAction}
        onDecide={controller.decide}
        onSubmitReview={controller.submitReview}
      />
    );
  const canChoose = controller.workflow?.status === 'completed';
  const adoption = canChoose
    ? {
        selected: adopted === currentSimulation?.id || review ? controller.selected : '',
        disabled: controller.blocked || !!controller.busy || published,
        onAdopt: (candidateId: string) => {
          if (
            manualView &&
            !currentSimulation?.candidates.some((item) => item.id === candidateId)
          ) {
            controller.switchAnalysis('ai');
            controller.setSelected(candidateId);
            controller.setAction('publish');
            setAdopted(controller.originalSimulation?.id ?? '');
            return;
          }
          controller.setSelected(candidateId);
          controller.setAction('publish');
          setAdopted(currentSimulation?.id ?? '');
        },
      }
    : undefined;
  useEffect(() => {
    if (!adopted || adopted !== currentSimulation?.id) return;
    document.getElementById('fault-human-decision')?.scrollIntoView?.({ block: 'nearest' });
  }, [adopted, currentSimulation?.id, controller.selected]);
  const manualControl = controller.originalWorkflow?.status === 'completed' && !published && (
    <div className="inline-actions fault-manual-action">
      <WriteButton
        disabled={controller.blocked || !!controller.busy}
        onClick={() => (manualView ? void controller.startManual() : openBasisPicker())}
      >
        {manualView ? '继续手动调整' : '不采纳，手动调整'}
      </WriteButton>
      {manualView && (
        <WriteButton disabled={controller.blocked || !!controller.busy} onClick={openBasisPicker}>
          重新选择编辑起点
        </WriteButton>
      )}
    </div>
  );
  const archived = published;
  const displaySimulation = archived ? archive?.simulation : currentSimulation;
  const displayWorkflow = archived ? (archive?.workflow ?? null) : controller.workflow;
  const displayState =
    archived && archive?.baseline
      ? { ...state, baseline: archive.baseline, affected: archive.affected ?? [] }
      : state;
  const analysisTime = displayWorkflow?.created_at;
  const hasDisplayCandidates = !!displaySimulation?.candidates.length && !generating;
  const aiCandidates = archived
    ? (publication?.variants?.ai?.simulation?.candidates ??
      (publication?.selected_variant === 'manual' ? [] : (displaySimulation?.candidates ?? [])))
    : (controller.originalSimulation?.candidates ?? []);
  const manualCandidate = archived
    ? publication?.variants?.manual?.simulation?.candidates[0]
    : controller.manualDraft?.status === 'ready_for_review'
      ? controller.manualDraft.simulation?.candidates[0]
      : undefined;
  const titleFor = (candidate: (typeof aiCandidates)[number]) =>
    candidateTitle(
      candidate,
      archived ? publication?.variants?.ai?.workflow : controller.originalWorkflow,
      controller.manualDraft?.workflow,
      displayWorkflow,
    );
  const named = (candidate: (typeof aiCandidates)[number]) => ({
    ...candidate,
    label: titleFor(candidate),
  });
  const allCandidates = [...aiCandidates, ...(manualCandidate ? [manualCandidate] : [])].map(named);
  const comparisonId =
    comparisonChoice && comparisonChoice.manualId === activeManual?.id
      ? comparisonChoice.id
      : (activeManual?.source_candidate_id ?? null);
  const originalCandidate = aiCandidates.find((item) => item.id === comparisonId);
  const comparisonSimulation =
    manualView && displaySimulation
      ? {
          ...displaySimulation,
          candidates: [
            ...displaySimulation.candidates.map(named),
            ...(originalCandidate ? [named(originalCandidate)] : []),
          ],
        }
      : displaySimulation
        ? { ...displaySimulation, candidates: displaySimulation.candidates.map(named) }
        : displaySimulation;
  const comparisonTimes = [
    ...(comparisonSimulation?.candidates.flatMap((candidate) => candidate.schedule.operations) ??
      []),
    ...displayState.baseline.operations,
  ].flatMap((operation) => [Date.parse(operation.start), Date.parse(operation.end)]);
  const comparisonRange: [number, number] = [
    Math.min(range[0], ...comparisonTimes),
    Math.max(range[1], ...comparisonTimes),
  ];
  const referenceSchedule = originalCandidate?.schedule ?? displayState.baseline;
  const referenceDelay =
    originalCandidate?.metrics.total_lateness_minutes ??
    manualCandidate?.order_impacts.reduce((sum, impact) => sum + impact['原延期(分钟)'], 0);
  const referenceEnd =
    originalCandidate?.metrics.makespan ??
    referenceSchedule.operations.reduce(
      (latest, op) => (Date.parse(op.end) > Date.parse(latest) ? op.end : latest),
      referenceSchedule.operations[0]?.end ?? '',
    );
  const sourceLabel = (sourceId: string | null | undefined) => {
    const source = aiCandidates.find((item) => item.id === sourceId);
    return source
      ? titleFor(source)
      : sourceId
        ? '原 AI 来源方案（当前不可用）'
        : `当前执行计划 V${state.baseline.version}`;
  };
  return (
    <div
      aria-label={archived ? '已发布故障方案存档' : undefined}
      className={`fault-stage${hasDisplayCandidates ? ' fault-stage-generated' : ' fault-stage-pending'}`}
    >
      <DecisionPageHeader
        title="故障影响与方案决策"
        status={
          <span
            className={`fault-stage-status${hasDisplayCandidates || assessment ? ' is-ready' : ''}`}
          >
            {published
              ? `计划已发布 V${publication.published_version ?? state.baseline.version}`
              : hasCandidates
                ? review?.status === 'approved'
                  ? '管理者已批准，待排产员发布'
                  : review?.status === 'pending'
                    ? '待管理者审批'
                    : '待提交管理者审批'
                : assessment
                  ? assessmentReview?.status === 'approved'
                    ? '评估结论已批准'
                    : assessmentReview?.status === 'pending'
                      ? '待管理者审批'
                      : '评估完成，待提交审批'
                  : generating
                    ? '方案生成中'
                    : controller.workflow?.status === 'blocked'
                      ? '生成受阻'
                      : controller.workflow?.status === 'failed'
                        ? '生成失败'
                        : '方案待生成'}
          </span>
        }
        breadcrumb={breadcrumb}
        description={
          published
            ? '方案已发布，以下分析存档仅供查阅。'
            : review?.status === 'approved'
              ? '管理者已批准，请核对方案后发布；修改方案后需要重新审批。'
              : review?.status === 'pending'
                ? '方案已提交管理者审批，批准后由排产员发布。'
                : hasCandidates
                  ? '候选方案已生成，请比较差异并提交管理者审批；批准后发布，修改后重新审批。'
                  : assessment
                    ? '本次生产条件检查与评估已完成，请审核实际发现并提交管理者审批。'
                    : '先确认故障影响和当前正式计划，再生成候选排产方案。'
        }
        actions={
          <>
            <button className="fault-header-back" onClick={onBack}>
              <span className="fault-back-arrow">←</span> 工作台总览
            </button>
            {(controller.originalWorkflow || archived) && (
              <FaultPlanSwitch
                view={manualView ? 'manual' : 'ai'}
                onChange={(view) =>
                  archived
                    ? setArchiveChoice({ revision: state.event_revision, view })
                    : controller.switchAnalysis(view)
                }
                hasAi={!archived || !!faultVariant(publication, 'ai')}
                aiStatus={
                  archived && !faultVariant(publication, 'ai')
                    ? '原始记录缺失'
                    : faultPlanStatus(
                        archived
                          ? publication?.variants?.ai?.simulation
                          : controller.originalSimulation,
                        archived ? null : state.fault_review,
                        archived
                          ? (publication?.variants?.ai ??
                              (publication?.selected_variant !== 'manual' ? publication : null))
                          : null,
                        controller.originalWorkflow?.id,
                      )
                }
                manualStatus={faultPlanStatus(
                  archived
                    ? publication?.variants?.manual?.simulation
                    : controller.manualDraft?.simulation,
                  archived ? null : state.fault_review,
                  faultVariant(publication, 'manual'),
                )}
                hasManual={
                  archived ? !!faultVariant(publication, 'manual') : !!controller.manualDraft
                }
              />
            )}
            {onBackToAnalysis && (
              <button className="fault-header-back" onClick={onBackToAnalysis}>
                ← 返回评估详情
              </button>
            )}
          </>
        }
      />
      <div className="fault-stage-grid">
        <div className="fault-stage-main">
          {hasDisplayCandidates ? (
            <>
              <section className="fault-stage-card fault-conclusion-card" id="fault-conclusion">
                <div className="fault-stage-card-heading">
                  <h2>1　方案结论</h2>
                </div>
                <div
                  className={`fault-conclusion-main${conclusion.improved ? ' is-improved' : ''}`}
                >
                  <span className="fault-conclusion-icon" aria-hidden="true">
                    {conclusion.improved ? '✓' : '→'}
                  </span>
                  <div>
                    <h3>
                      <DecisionText
                        text={
                          archived
                            ? `${manualView ? '人工调整方案' : '原 AI 方案'} · 历史分析存档`
                            : conclusion.headline
                        }
                      />
                    </h3>
                    <p>
                      {archived
                        ? `实际发布：${publishedVariant(publication) === 'manual' ? '人工调整方案' : '原 AI 方案'}，执行计划 V${publication?.published_version ?? state.baseline.version}。切换仅查看各方案存档。`
                        : conclusion.context}
                    </p>
                  </div>
                </div>
                <ContributionReport
                  candidate={
                    displaySimulation?.candidates.find(
                      (item) =>
                        item.id ===
                        (archived
                          ? (archive?.selected_candidate_id ?? archive?.decisions?.candidate_id)
                          : controller.selected),
                    ) ??
                    (displaySimulation?.candidates.length === 1
                      ? displaySimulation.candidates[0]
                      : undefined)
                  }
                  result={displayWorkflow}
                  published={
                    archived &&
                    (archive?.decisions?.status === 'published' ||
                      archive?.published_version !== undefined)
                  }
                  report={
                    archived
                      ? (archive?.report ?? displayWorkflow?.contribution_report)
                      : displayWorkflow?.contribution_report
                  }
                />
                {!displayWorkflow?.contribution_report &&
                  !archive?.report &&
                  !displaySimulation?.candidates.length && <TrustScore result={displayWorkflow} />}
                {!published && !manualView && generationControls}
                <footer className="fault-conclusion-metadata" aria-label="方案分析标识">
                  <span>
                    基线 V{displayState.baseline.version} · 故障 R
                    {archived ? publication.event_revision : state.event_revision}
                  </span>
                  <span>
                    {analysisTime && Number.isFinite(Date.parse(analysisTime))
                      ? `分析于 ${stamp(analysisTime)}`
                      : '分析时间未记录'}
                  </span>
                  <span className="fault-conclusion-trace">
                    Trace：
                    {(archived ? displayWorkflow?.trace_id : analysisTrace) ? (
                      <TraceBadge traceId={archived ? displayWorkflow?.trace_id : analysisTrace} />
                    ) : (
                      '未记录'
                    )}
                  </span>
                </footer>
              </section>
              <section
                className="fault-stage-card fault-compare-summary"
                id="fault-compare-summary"
              >
                <div className="fault-stage-card-heading">
                  <h2>2　方案对比</h2>
                  <div className="inline-actions">
                    <span>同一时间轴对照变化</span>
                  </div>
                </div>
                <div className="fault-compare-tiles">
                  <article>
                    <h3>{archived ? '分析时的执行计划' : '当前正式计划'}</h3>
                    <p>受影响 {displayState.affected.length} 道工序</p>
                    <p>保持现有设备与时间</p>
                  </article>
                  <article>
                    <h3>候选排产方案</h3>
                    <p>
                      调整{' '}
                      {displaySimulation?.candidates.find(
                        (item) => item.id === controller.candidate?.id,
                      )?.metrics.moved_operations ??
                        displaySimulation?.candidates[0]?.metrics.moved_operations ??
                        0}{' '}
                      道工序
                    </p>
                    <p>请结合交期与资源变化审核</p>
                  </article>
                </div>
                {allCandidates.length > 0 && (
                  <MetricsTable candidates={allCandidates} manualDraft={controller.manualDraft} />
                )}
              </section>
              <section className="fault-stage-card fault-candidate-card" id="fault-candidate">
                <div className="fault-stage-card-heading">
                  <h2>3　候选排产计划</h2>
                  <span>设备 · 时间 · 工序</span>
                </div>
                {!archived && manualView && activeManual && (
                  <>
                    <label className="manual-comparison-select">
                      人工方案对照对象
                      <select
                        value={originalCandidate?.id ?? 'baseline'}
                        onChange={(event) =>
                          setComparisonChoice({
                            manualId: activeManual.id,
                            id: event.target.value === 'baseline' ? null : event.target.value,
                          })
                        }
                      >
                        <option value="baseline">
                          当前执行计划 V{displayState.baseline.version}（只读）
                        </option>
                        {aiCandidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {titleFor(candidate)}
                            {candidate.id === activeManual.source_candidate_id
                              ? '（编辑起点）'
                              : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="hint">
                      编辑起点：{sourceLabel(activeManual.source_candidate_id)}
                      。切换对照不修改人工安排，也不代表采纳。
                    </p>
                    {manualCandidate && referenceDelay !== undefined && (
                      <p className="manual-comparison-delta" aria-label="人工方案相对对照差异">
                        相对{originalCandidate ? titleFor(originalCandidate) : '当前执行计划'}：
                        总延期差 {manualCandidate.metrics.total_lateness_minutes - referenceDelay}{' '}
                        分钟（负值表示减少）； 完工时间差{' '}
                        {(Date.parse(manualCandidate.metrics.makespan) - Date.parse(referenceEnd)) /
                          60000}{' '}
                        分钟（负值表示提前）； 工序安排不同{' '}
                        {changedOperationCount(referenceSchedule, manualCandidate.schedule)} 道。
                      </p>
                    )}
                  </>
                )}
                {comparisonSimulation && (
                  <Comparison
                    state={displayState}
                    simulation={comparisonSimulation}
                    range={comparisonRange}
                    workflow={displayWorkflow}
                    referenceWorkflow={
                      archived ? publication?.variants?.ai?.workflow : controller.originalWorkflow
                    }
                    mode="plans"
                    archived={archived}
                    adoption={archived ? undefined : adoption}
                  />
                )}
                {manualControl}
              </section>
            </>
          ) : (
            <>
              <section className="fault-stage-card fault-overview" id="fault-conclusion">
                <h2>1　方案结论</h2>
                {assessment ? (
                  <div aria-label="评估结论与审批">
                    <ContributionReport
                      report={controller.workflow?.contribution_report}
                      result={controller.workflow}
                    />
                    {!controller.workflow?.contribution_report && !activeManual && (
                      <TrustScore result={controller.workflow} />
                    )}
                    <p>
                      {controller.workflow?.results.explanation?.data?.summary ??
                        assessment.summary}
                    </p>
                    <ul>
                      {assessment.findings.map((item, i) => (
                        <li key={i}>
                          <DecisionText text={item.text} />
                        </li>
                      ))}
                    </ul>
                    <h3>处理建议</h3>
                    <ul>
                      {assessment.recommendations.map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ul>
                    {assessment.limitations.map((text) => (
                      <p className="hint" key={text}>
                        {text}
                      </p>
                    ))}
                    {assessmentReview && (
                      <p>
                        管理者审批：
                        {assessmentReview.status === 'approved'
                          ? '已批准评估结论'
                          : assessmentReview.status === 'pending'
                            ? '待审批'
                            : '已退回'}
                        {assessmentReview.review_reason && ` · ${assessmentReview.review_reason}`}
                      </p>
                    )}
                  </div>
                ) : (
                  <p>
                    {generating
                      ? '正在生成候选方案，完成后展示结论。'
                      : '方案尚未生成，请确认故障信息后生成候选。'}
                  </p>
                )}
                <div className="fault-overview-stats">
                  <div>
                    <span>故障设备</span>
                    <strong>{state.event.machine_id}</strong>
                  </div>
                  <div>
                    <span>故障时段</span>
                    <strong>
                      {stamp(state.event.started_at)} —{' '}
                      {state.event.recovered_at ? stamp(state.event.recovered_at) : '恢复时间未知'}
                    </strong>
                  </div>
                  <div>
                    <span>直接影响</span>
                    <strong>{state.affected.length} 道工序</strong>
                  </div>
                </div>
                <p className="fault-stage-note">
                  故障 R{state.event_revision} · 来源：{state.event.source}
                </p>
                {!manualView && generationControls}
                <GenerationLoading running={generating} />
                {manualView && (
                  <WorkflowPanel
                    running={generating}
                    disabled
                    result={controller.workflow}
                    progress={controller.progress}
                    onRun={controller.runWorkflow}
                    view="chain"
                  />
                )}
              </section>
              <section className="fault-stage-card" id="fault-compare-summary">
                <h2>2　方案对比</h2>
                <p>
                  {assessment
                    ? '当前条件下无可执行候选，不能比较候选收益。'
                    : '生成候选后展示指标和方案差异。'}
                </p>
              </section>
              <section className="fault-stage-card fault-baseline-card" id="fault-candidate">
                <div className="fault-stage-card-heading">
                  <h2>3　候选排产计划</h2>
                  <span>当前正式计划 V{state.baseline.version}</span>
                </div>
                <p>暂无候选，以下为当前正式计划。</p>
                {currentPlan}
                {activeManual?.issues.map((issue) => (
                  <p className="message warning" role="alert" key={issue}>
                    {issue}
                  </p>
                ))}
                {manualControl}
              </section>
            </>
          )}
          {controller.manualEditor && (
            <ManualFaultPanel
              draft={controller.manualEditor}
              state={state}
              range={range}
              busy={controller.busy}
              disabled={controller.dirty || controller.stale || published}
              sourceLabel={sourceLabel(controller.manualEditor.source_candidate_id)}
              onMove={controller.moveManual}
              onConfirm={controller.confirmManual}
              onCancel={cancelEditor}
              breadcrumb={manualBreadcrumb(true)}
            />
          )}
          {choosingBasis && !controller.manualEditor && (
            <ManualBasisPicker
              state={state}
              simulation={controller.originalSimulation}
              workflow={controller.originalWorkflow}
              range={range}
              breadcrumb={manualBreadcrumb(false)}
              selected={basisSelection}
              onSelected={setBasisSelection}
              acknowledged={basisAcknowledged}
              onAcknowledged={setBasisAcknowledged}
              replacing={!!controller.manualDraft}
              disabled={controller.blocked || !!controller.busy || published}
              onCancel={() => setChoosingBasis(false)}
              onChoose={(basis) => {
                setChoosingBasis(false);
                void controller.startManual(basis);
              }}
            />
          )}
          <section className="fault-stage-card fault-evidence-card" id="fault-evidence">
            <div className="fault-stage-card-heading">
              <h2>4　依据与风险</h2>
              <span>结论与假设 · 排程对比 · 资源与执行</span>
            </div>
            <FaultDecisionEvidence
              controller={controller}
              state={displayState}
              simulation={comparisonSimulation}
              workflow={displayWorkflow}
              activeTab={activeTab}
              onTab={setActiveTab}
              archived={archived}
            />
          </section>
          <section
            ref={approvalRef}
            tabIndex={-1}
            className="fault-stage-card fault-human-decision"
            id="fault-human-decision"
            aria-label={showApproval ? '审批结果与计划发布' : '人工确认'}
          >
            <div className="fault-stage-card-heading">
              <h2>5　人工确认</h2>
              {!archived && (
                <WriteButton disabled={!!controller.busy} onClick={onAdjust}>
                  返回调整
                </WriteButton>
              )}
            </div>
            {showApproval && state.fault_review && (
              <div>
                <h3>审批详情</h3>
                <p>
                  {state.fault_review.status === 'approved'
                    ? state.fault_review.kind === 'assessment'
                      ? '管理者已批准评估结论，无需发布排产变更。'
                      : '管理者已批准，工单已流转回排产员，待发布计划。'
                    : state.fault_review.status === 'pending'
                      ? '已提交管理者审批，审批通过后由排产员发布计划。'
                      : state.fault_review.status === 'rejected'
                        ? '管理者已退回，修改方案后需重新提交审批。'
                        : state.fault_review.status === 'published'
                          ? `排产员已发布计划 V${state.baseline.version}，流程已完成。`
                          : '该审批已失效，请查看最新评估结果。'}
                </p>
                <p>提交理由：{state.fault_review.reason}</p>
                <p>审批意见：{state.fault_review.review_reason || '暂无'}</p>
                <ContributionReport report={state.fault_review.analysis?.report} />
                {state.fault_review.reviewed_at && (
                  <p>审批时间：{stamp(state.fault_review.reviewed_at)}</p>
                )}
                {state.fault_review.kind !== 'assessment' && (
                  <p>审批方案：{state.fault_review.candidate_label}</p>
                )}
              </div>
            )}
            {!archived && assessment && !activeManual && (
              <>
                <label>
                  提交理由（必填）
                  <textarea
                    maxLength={2000}
                    value={controller.reason}
                    onChange={(event) => controller.setReason(event.target.value)}
                    disabled={!!controller.busy}
                  />
                </label>
                <WriteButton
                  className="primary"
                  disabled={
                    !!controller.busy ||
                    controller.blocked ||
                    !controller.reason.trim() ||
                    assessmentReview?.status === 'pending' ||
                    assessmentReview?.status === 'approved'
                  }
                  onClick={controller.submitReview}
                >
                  {assessmentReview?.status === 'approved'
                    ? '评估结论已批准'
                    : assessmentReview?.status === 'pending'
                      ? '等待管理者审批'
                      : '提交管理者审批'}
                </WriteButton>
              </>
            )}
            {!archived && hasCandidates && decisionPanel}
            {(archived || (!assessment && !decisionPanel)) && (
              <p className="hint">
                {archived
                  ? '方案已发布，分析存档仅供查阅。'
                  : hasCandidates
                    ? '请在对应方案卡片内采纳方案，或转人工手动排产。'
                    : '生成候选并完成评估后，可提交管理者审批。'}
              </p>
            )}
          </section>
          <section className="fault-stage-card fault-history-card" id="fault-history">
            <div className="fault-stage-card-heading">
              <h2>6　历史记录</h2>
            </div>
            <DecisionHistory history={state.history} flat />
          </section>
        </div>
        <FaultPlanOutline onSelectTab={setActiveTab} />
      </div>
    </div>
  );
}
