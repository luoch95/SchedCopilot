import type { Simulation, Workbench, WorkflowResult } from '../shared/api/contracts';
import type { useWorkbench } from '../features/workbench';
import { AnalysisPanel, WorkflowPanel } from '../features/analysis';
import { EvaluationSummary, DecisionComparisonTabs } from '../features/comparison';

export const evidenceEntries = [
  ['section-facts', '4.1 事实/假设与风险'],
  ['section-advice', '4.2 取舍与建议'],
  ['section-analysis-detail', '4.3 风险与完整分析明细'],
  ['section-operations', '4.4 工序调整对照'],
  ['section-orders', '4.5 订单交付对照'],
  ['section-impact', '4.6 工序变化与影响链'],
  ['section-evidence', '4.7 方案计算依据'],
  ['section-resources', '4.8 展开换型与资源评估'],
  ['section-question', '4.9 解释问题'],
  ['section-agent-chain', '4.10 查看本次 Agent 链路'],
  ['section-execution-details', '4.11 执行详情'],
] as const;

export function FaultDecisionEvidence({
  controller,
  state,
  simulation,
  workflow,
  activeTab,
  onTab,
  archived = false,
}: {
  controller: ReturnType<typeof useWorkbench>;
  state: Workbench;
  simulation?: Simulation | null;
  workflow: WorkflowResult | null;
  activeTab: string;
  onTab: (id: string) => void;
  archived?: boolean;
}) {
  const analysisProps = workflow && {
    simulation,
    busy: controller.busy,
    question: controller.question,
    result: workflow,
    onQuestion: controller.changeQuestion,
    onExplain: controller.askQuestion,
    answer: controller.answer,
    asking: controller.asking,
    askError: controller.askError,
    disabled: controller.dirty || controller.stale || archived,
    readOnly: archived,
  };
  const chainProps = {
    running:
      !archived &&
      controller.activeIntent !== null &&
      (controller.busy !== '评估人工草案' || controller.analysisView === 'manual'),
    disabled:
      archived ||
      !!controller.busy ||
      controller.dirty ||
      controller.stale ||
      !!controller.activeManual,
    result: workflow,
    progress:
      archived || (controller.busy === '评估人工草案' && controller.analysisView === 'ai')
        ? null
        : controller.progress,
    onRun: controller.runWorkflow,
    readOnly: archived || !!controller.activeManual,
  };
  return (
    <>
      <div className="decision-analysis-block" aria-label="分析结论与假设">
        {analysisProps && workflow?.results.explanation?.data ? (
          <AnalysisPanel {...analysisProps} view="conclusions" />
        ) : (
          evidenceEntries.slice(0, 3).map(([id, title]) => (
            <section className="decision-analysis-card" key={id}>
              <h3 id={id}>{title}</h3>
              <p>
                {controller.activeManual
                  ? '人工调整后的方案尚无独立分析，请核对计算依据与约束。'
                  : '暂无完整解释，已有检查结果可在执行详情中查看。'}
              </p>
            </section>
          ))
        )}
      </div>
      <DecisionComparisonTabs
        state={state}
        simulation={simulation}
        workflow={workflow}
        referenceWorkflow={controller.activeManual ? controller.originalWorkflow : null}
        active={activeTab}
        onActive={onTab}
      />
      <div className="decision-system-panels" aria-label="资源评估与系统执行">
        {evidenceEntries.slice(7).map(([id, title], index) => (
          <details
            key={id}
            id={index === 3 ? 'fault-execution-panel' : `${id}-panel`}
            className="decision-accordion decision-system-panel"
          >
            <summary>
              <h3 id={id}>{title}</h3>
            </summary>
            <div className="decision-accordion-content">
              {index === 0 &&
                (workflow && simulation ? (
                  <EvaluationSummary result={workflow} simulation={simulation} />
                ) : (
                  <p>暂无资源评估结果。</p>
                ))}
              {index === 1 &&
                (analysisProps && !archived ? (
                  <AnalysisPanel {...analysisProps} view="question" />
                ) : (
                  <p>当前没有可供提问的分析结果。</p>
                ))}
              {index === 2 && <WorkflowPanel {...chainProps} view="chain" />}
              {index === 3 && <WorkflowPanel {...chainProps} view="execution" />}
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
