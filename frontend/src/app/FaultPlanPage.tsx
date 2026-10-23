import { FaultPlanOutline } from './FaultPlanOutline';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import type { Workbench } from '../shared/api/contracts';
import { AnalysisPanel, WorkflowPanel } from '../features/analysis';
import {
  Comparison,
  MetricsTable,
  EvaluationSummary,
  planConclusion,
} from '../features/comparison';
import { DecisionPanel } from '../features/decisions';
import { SimulationActions } from '../features/events';
import { DecisionHistory } from '../features/history';
import type { useWorkbench } from '../features/workbench';
import { publishedFault } from '../features/workbench';
import { DecisionText } from '../shared/ui/DecisionText';
import { WriteButton } from '../shared/ui/WriteButton';
import { TraceBadge } from '../shared/ui/TraceTree';
import { GenerationLoading } from '../shared/ui/GenerationLoading';
import { stamp } from '../shared/lib/time';

interface Props {
  controller: ReturnType<typeof useWorkbench>;
  state: Workbench;
  range: [number, number];
  currentPlan: ReactNode;
  roleControl: ReactNode;
  onAdjust: () => void;
  showApproval?: boolean;
}

export function FaultPlanPage({
  controller,
  state,
  range,
  currentPlan,
  roleControl,
  onAdjust,
  showApproval = false,
}: Props) {
  const approvalRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!showApproval) return;
    approvalRef.current?.scrollIntoView?.({ block: 'start' });
    approvalRef.current?.focus({ preventScroll: true });
  }, [showApproval, state.fault_review?.id]);
  const { currentSimulation } = controller;
  const published = !!publishedFault(state);
  const generating = controller.activeIntent === 'generate_candidates';
  const hasCandidates = !!currentSimulation?.candidates.length && !generating;
  const assessment =
    !generating && controller.workflow?.status === 'completed'
      ? controller.workflow.results.evaluation?.data?.assessment
      : null;
  const assessmentReview =
    assessment && state.fault_review?.workflow_id === controller.workflow?.id
      ? state.fault_review
      : null;
  const conclusion = planConclusion(currentSimulation?.candidates ?? [], controller.workflow);
  const analysisTime = controller.workflow?.created_at;
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
  const agentChain = (
    <WorkflowPanel
      running={controller.activeIntent !== null}
      disabled={!!controller.busy || controller.dirty || controller.stale}
      result={controller.workflow}
      progress={controller.progress}
      onRun={controller.runWorkflow}
    />
  );
  const decisionPanel = currentSimulation && (
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
      onSubmitReview={controller.submitReview}
    />
  );
  return (
    <div
      className={`fault-stage${hasCandidates ? ' fault-stage-generated' : ' fault-stage-pending'}`}
    >
      <header className="fault-stage-header">
        <div className="fault-stage-title">
          <div className="fault-stage-heading">
            <h1>故障影响与方案决策</h1>
            <span className={`fault-stage-status${hasCandidates ? ' is-ready' : ''}`}>
              {published
                ? `计划已发布 V${state.baseline.version}`
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
          </div>
          <p>
            {hasCandidates
              ? '候选方案已生成，请比较差异并提交管理者审批；批准后发布，修改后重新审批。'
              : assessment
                ? '本次生产条件检查与评估已完成，请审核实际发现并提交管理者审批。'
                : '先确认故障影响和当前正式计划，再生成候选排产方案。'}
          </p>
        </div>
        <div className="fault-stage-meta">
          {roleControl || <span>演示角色：排产计划员</span>}
          <span className="fault-environment">仿真数据</span>
        </div>
      </header>
      <div className="fault-stage-grid">
        <div className="fault-stage-main">
          {showApproval && state.fault_review && (
            <section
              ref={approvalRef}
              id="fault-human-decision"
              tabIndex={-1}
              className="fault-stage-card"
              aria-label="审批结果与计划发布"
            >
              <h2>审批详情</h2>
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
              {state.fault_review.reviewed_at && (
                <p>审批时间：{stamp(state.fault_review.reviewed_at)}</p>
              )}
              {state.fault_review.kind !== 'assessment' && (
                <p>审批方案：{state.fault_review.candidate_label}</p>
              )}
              {hasCandidates && decisionPanel}
            </section>
          )}
          {!hasCandidates ? (
            <>
              {assessment && (
                <section className="fault-stage-card" aria-label="评估结论与审批">
                  <h2>本次评估结果</h2>
                  <p>{assessment.summary}</p>
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
                </section>
              )}
              <section className="fault-stage-card fault-overview" id="fault-overview">
                <h2>1　故障概览</h2>
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
              </section>
              <section className="fault-stage-card fault-baseline-card" id="fault-baseline">
                <div className="fault-stage-card-heading">
                  <h2>2　当前正式排产计划</h2>
                  <span>正式计划 V{state.baseline.version}</span>
                </div>
                {currentPlan}
                <p className="hint">当前只展示正式计划；生成候选不会更改执行安排。</p>
              </section>
              <section className="fault-stage-card fault-generate-card" id="fault-generate">
                <h2>3　生成候选方案</h2>
                <p>系统按故障、换型和设备资源约束生成可比较的候选计划。</p>
                {generationControls}
                <GenerationLoading running={generating} />
                <details
                  className="fault-agent-disclosure"
                  open={
                    controller.activeIntent !== null ||
                    !!controller.workflow ||
                    !!controller.progress
                  }
                >
                  <summary>查看本次 Agent 链路</summary>
                  <div className="fault-stage-workflow">{agentChain}</div>
                </details>
                {controller.workflow && (
                  <AnalysisPanel
                    busy={controller.busy}
                    question={controller.question}
                    result={controller.workflow}
                    onQuestion={controller.changeQuestion}
                    onExplain={() => controller.runWorkflow('explain')}
                  />
                )}
              </section>
            </>
          ) : (
            <>
              <section className="fault-stage-card fault-conclusion-card" id="fault-conclusion">
                <div className="fault-stage-card-heading">
                  <h2>1　方案结论</h2>
                  <WriteButton
                    className="secondary"
                    disabled={!!controller.busy || controller.dirty || controller.stale}
                    onClick={controller.generate}
                  >
                    重新生成方案
                  </WriteButton>
                </div>
                <div
                  className={`fault-conclusion-main${conclusion.improved ? ' is-improved' : ''}`}
                >
                  <span className="fault-conclusion-icon" aria-hidden="true">
                    {conclusion.improved ? '✓' : '→'}
                  </span>
                  <div>
                    <h3>
                      <DecisionText text={conclusion.headline} />
                    </h3>
                    <p>{conclusion.context}</p>
                  </div>
                </div>
                <footer className="fault-conclusion-metadata" aria-label="方案分析标识">
                  <span>
                    基线 V{state.baseline.version} · 故障 R{state.event_revision}
                  </span>
                  <span>
                    {analysisTime && Number.isFinite(Date.parse(analysisTime))
                      ? `分析于 ${stamp(analysisTime)}`
                      : '分析时间未记录'}
                  </span>
                  <span className="fault-conclusion-trace">
                    Trace：{analysisTrace ? <TraceBadge traceId={analysisTrace} /> : '未记录'}
                  </span>
                </footer>
              </section>
              <section
                className="fault-stage-card fault-compare-summary"
                id="fault-compare-summary"
              >
                <div className="fault-stage-card-heading">
                  <h2>2　方案对比</h2>
                  <span>同一时间轴对照变化</span>
                </div>
                <div className="fault-compare-tiles">
                  <article>
                    <h3>当前正式计划</h3>
                    <p>受影响 {state.affected.length} 道工序</p>
                    <p>保持现有设备与时间</p>
                  </article>
                  <article>
                    <h3>候选排产方案</h3>
                    <p>
                      调整{' '}
                      {currentSimulation?.candidates.find(
                        (item) => item.id === controller.candidate?.id,
                      )?.metrics.moved_operations ??
                        currentSimulation?.candidates[0]?.metrics.moved_operations ??
                        0}{' '}
                      道工序
                    </p>
                    <p>请结合交期与资源变化审核</p>
                  </article>
                </div>
                {currentSimulation && <MetricsTable candidates={currentSimulation.candidates} />}
              </section>
              <section className="fault-stage-card fault-candidate-card" id="fault-candidate">
                <div className="fault-stage-card-heading">
                  <h2>3　候选排产计划</h2>
                  <span>设备 · 时间 · 工序</span>
                </div>
                {currentSimulation && (
                  <Comparison
                    state={state}
                    simulation={currentSimulation}
                    range={range}
                    workflow={controller.workflow}
                    mode="plans"
                  />
                )}
              </section>
              <section className="fault-stage-card fault-evidence-card" id="fault-evidence">
                <div className="fault-stage-card-heading">
                  <h2>4　依据与风险</h2>
                  <span>换型、设备约束、影响链和未满足条件</span>
                </div>
                {controller.workflow && (
                  <details className="fault-evidence-details">
                    <summary>展开分析结论、事实与风险</summary>
                    <AnalysisPanel
                      busy={controller.busy}
                      question={controller.question}
                      result={controller.workflow}
                      onQuestion={controller.changeQuestion}
                      onExplain={() => controller.runWorkflow('explain')}
                    />
                  </details>
                )}
                {currentSimulation && controller.workflow && (
                  <details className="fault-evidence-details">
                    <summary>展开换型与资源评估</summary>
                    <EvaluationSummary
                      result={controller.workflow}
                      simulation={currentSimulation}
                    />
                  </details>
                )}
                {currentSimulation && (
                  <details className="fault-evidence-details">
                    <summary>展开工序变化、影响链与计算依据</summary>
                    <div className="fault-evidence-content">
                      <Comparison
                        state={state}
                        simulation={currentSimulation}
                        range={range}
                        workflow={controller.workflow}
                        mode="details"
                      />
                    </div>
                  </details>
                )}
                <details className="fault-evidence-details" open={controller.activeIntent !== null}>
                  <summary>查看本次 Agent 链路与重新生成</summary>
                  {generationControls}
                  {agentChain}
                </details>
              </section>
              {!showApproval && (
                <section
                  className="fault-stage-card fault-human-decision"
                  id="fault-human-decision"
                >
                  <div className="fault-stage-card-heading">
                    <h2>5　人工确认</h2>
                    <WriteButton disabled={!!controller.busy} onClick={onAdjust}>
                      返回调整
                    </WriteButton>
                  </div>
                  {decisionPanel}
                </section>
              )}
              <DecisionHistory history={state.history} />
            </>
          )}
        </div>
        <FaultPlanOutline hasCandidates={hasCandidates} />
      </div>
    </div>
  );
}
