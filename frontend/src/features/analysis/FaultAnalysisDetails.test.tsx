import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { FaultAnalysisDetails } from './FaultAnalysisDetails';
import { workbench } from '../../test/fixtures';
import type { ContributionReport, Workbench, WorkflowResult } from '../../shared/api/contracts';

const currentReport = {
  title: '本次故障分析报告',
  rules_work: '本次规则校验',
  model_work: '本次证据解释',
  manual_summary: '本次尚无人工调整',
  edits: [],
  risks: [],
  decision: '尚未发布',
} satisfies ContributionReport;
const workflow: WorkflowResult = {
  id: 'current-workflow',
  intent: 'generate_candidates',
  status: 'completed',
  failure_code: null,
  trace: [],
  results: {},
  evidence_catalog: {},
  contribution_report: currentReport,
};
const legacyReport = {
  manual_summary: '旧故障的人工决策记录',
  decision: '旧计划已发布',
};
function state(revision: number): Workbench {
  return {
    ...workbench,
    event_revision: 10,
    plan_publication: {
      version: 4,
      published_at: null,
      published_by: null,
      version_summary: '旧版本发布结果',
      fault_analysis: {
        event_revision: revision,
        baseline_version: 3,
        affected: [],
        workflow: null,
        baseline: workbench.baseline,
        report: legacyReport,
      },
    },
  };
}

it('opens current analysis without mixing a previous fault publication report', () => {
  render(<FaultAnalysisDetails state={state(2)} workflow={workflow} />);
  expect(screen.getByText(currentReport.title)).toBeTruthy();
  expect(screen.queryByText('旧故障的人工决策记录')).toBeNull();
  expect(screen.queryByText(/旧版本发布结果/)).toBeNull();
  expect(screen.getByRole('heading', { name: '本次智能分析链路' })).toBeTruthy();
});

it('opens matching historical reports without new fields and marks missing details', () => {
  render(<FaultAnalysisDetails state={state(10)} workflow={null} />);
  expect(screen.getByText('旧故障的人工决策记录')).toBeTruthy();
  expect(screen.getByText('旧计划已发布')).toBeTruthy();
  expect(screen.getByText('历史记录未保存人工修改明细。')).toBeTruthy();
  expect(screen.getByText('历史记录未保存风险明细。')).toBeTruthy();
});

it('does not fill a missing archived workflow with caller workflow scores or explanations', () => {
  render(<FaultAnalysisDetails state={state(10)} workflow={workflow} />);
  expect(screen.getByText('旧故障的人工决策记录')).toBeTruthy();
  expect(screen.queryByText(currentReport.title)).toBeNull();
  expect(screen.getByText('评估可信度：暂无法量化')).toBeTruthy();
  expect(screen.getByText('暂无完整分析记录，请同步最新数据。').getAttribute('role')).toBe(
    'status',
  );
});
