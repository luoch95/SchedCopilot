import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowResult, WorkflowProgress } from '../../shared/api/contracts';
import { WorkflowPanel } from './WorkflowPanel';

describe('workflow execution notices', () => {
  it('completes the chain with an actual no-candidate assessment instead of a workflow error', () => {
    const result: WorkflowResult = {
      id: 'assessment',
      intent: 'generate_candidates',
      status: 'completed',
      failure_code: null,
      evidence_catalog: {},
      trace: ['validate', 'schedule', 'evaluate', 'explain'].map((action) => ({
        action,
        status: action === 'schedule' ? 'blocked' : 'warning',
        result_ref: null,
        error_code: null,
      })),
      results: {
        scheduling: {
          status: 'blocked',
          data: null,
          warnings: [],
          errors: [
            {
              code: 'NO_FEASIBLE_CANDIDATE',
              message: 'M2 超出班次',
              repair_hint: '补录班次',
              evidence_refs: [],
            },
          ],
        },
        evaluation: {
          status: 'warning',
          warnings: [],
          errors: [],
          data: {
            evaluations: [],
            assessment: {
              outcome: 'no_feasible_candidate',
              summary: '分析已完成，当前策略未生成可用方案',
              findings: [{ text: 'M2 工序预计 00:45 完工，超过班次 00:00', evidence_refs: [] }],
              recommendations: ['按实际安排补录班次'],
              limitations: ['审批结论不发布排产变更'],
            },
          },
        },
      },
    };
    render(<WorkflowPanel running={false} disabled result={result} onRun={vi.fn()} />);
    expect(screen.getByText('工作流：已完成')).toBeTruthy();
    expect(screen.getByLabelText('本次评估结论').textContent).toContain('00:45');
    expect(screen.queryByLabelText('排产执行未完成原因')).toBeNull();
    expect(screen.getByLabelText('智能环节执行顺序').children[1].getAttribute('data-status')).toBe(
      'warning',
    );
    expect(screen.queryByText('阻断环节已标注，后续依赖环节未执行。')).toBeNull();
  });
  it.each([
    ['validation', '数据校验'],
    ['scheduling', '排产执行'],
    ['evaluation', '方案评估'],
    ['explanation', '结果解释'],
  ] as const)('shows the actual %s finding and advice outside execution details', (name, label) => {
    const result: WorkflowResult = {
      id: 'blocked',
      intent: 'generate_candidates',
      status: 'blocked',
      failure_code: null,
      trace: [],
      evidence_catalog: {},
      results: {
        [name]: {
          status: 'blocked',
          data: null,
          warnings: [],
          errors: [
            {
              code: 'BUSINESS_CONDITION',
              message: '工序 O1005-OP2 在 M2 最早 19:45 开工，预计次日 00:45 完工，超出班次。',
              repair_hint: '请按实际安排补录次日班次。',
              evidence_refs: [],
            },
          ],
        },
      },
    };
    render(<WorkflowPanel running={false} disabled result={result} onRun={vi.fn()} />);
    const summary = screen.getByRole('region', { name: `${label}未完成原因` });
    expect(summary.closest('details')).toBeNull();
    expect(summary.textContent).toContain('O1005-OP2');
    expect(summary.textContent).toContain('00:45');
    expect(summary.textContent).toContain('请按实际安排补录次日班次。');
    expect(summary.textContent).not.toContain('系统执行失败');
  });

  it('marks skipped dependencies while the explanation of a validation block is running', () => {
    const progress: WorkflowProgress = {
      intent: 'generate_candidates',
      actions: ['validate', 'schedule', 'evaluate', 'explain'],
      active: 'explain',
      interrupted: false,
      trace: [
        {
          action: 'validate',
          status: 'blocked',
          result_ref: null,
          error_code: 'RECOVERY_REQUIRED',
        },
      ],
      results: { validation: { status: 'blocked', warnings: [], errors: [], data: null } },
    };
    const { rerender } = render(
      <WorkflowPanel running disabled result={null} progress={progress} onRun={vi.fn()} />,
    );
    const stages = screen.getByLabelText('智能环节执行顺序');
    expect(stages.children[0].getAttribute('data-status')).toBe('blocked');
    expect(stages.querySelectorAll('[data-status="skipped"]')).toHaveLength(2);
    expect(stages.children[3].getAttribute('data-status')).toBe('running');
    rerender(
      <WorkflowPanel
        running={false}
        disabled={false}
        result={null}
        progress={{ ...progress, active: null, interrupted: true }}
        onRun={vi.fn()}
      />,
    );
    expect(screen.getByText('执行进度已中断')).toBeTruthy();
    expect(screen.getAllByText('状态未确认')).toHaveLength(3);
    expect(stages.querySelectorAll('[data-status="running"]')).toHaveLength(0);
    expect(stages.children[0].getAttribute('data-status')).toBe('blocked');
  });

  it('does not claim a rule result is usable when the underlying Agent failed', () => {
    const result: WorkflowResult = {
      id: 'failed',
      trace_id: 'TRC-FAILED-TEST',
      intent: 'generate_candidates',
      status: 'failed',
      failure_code: null,
      results: {},
      evidence_catalog: {},
      trace: [
        {
          action: 'evaluate',
          status: 'failed',
          result_ref: null,
          error_code: 'EVALUATION_TOOL_FAILED',
          execution: {
            mode: 'fallback',
            model: 'test',
            calls: 1,
            input_tokens: null,
            output_tokens: null,
            elapsed_ms: 200,
            error_code: 'AGENT_TOOL_FAILED',
            prompt_sha256: 'hash',
            highlights: [],
          },
        },
      ],
    };
    render(<WorkflowPanel running={false} disabled={false} result={result} onRun={vi.fn()} />);
    expect(screen.getAllByText('TRC-FAILED-TEST')).toHaveLength(1);
    const notice = screen.getByLabelText('模型辅助执行情况');
    expect(notice.textContent).toContain('方案评估：模型辅助未完成');
    expect(notice.textContent).toContain('业务工具执行失败');
    expect(notice.textContent).toContain('该环节执行失败，未得到可用结果');
    expect(notice.textContent).not.toContain('规则评估已完成');
    expect(screen.getByText(/本次已完成 0\/1/)).toBeTruthy();
  });
});
