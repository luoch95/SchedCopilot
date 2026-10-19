import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowResult, WorkflowProgress } from '../../shared/api/contracts';
import { WorkflowPanel } from './WorkflowPanel';

describe('workflow execution notices', () => {
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
    const stages = screen.getByLabelText('Agent 执行顺序');
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
    const notice = screen.getByLabelText('模型辅助执行情况');
    expect(notice.textContent).toContain('方案评估 Agent：模型辅助未完成');
    expect(notice.textContent).toContain('业务工具执行失败');
    expect(notice.textContent).toContain('该环节执行失败，未得到可用结果');
    expect(notice.textContent).not.toContain('规则评估已完成');
    expect(screen.getByText(/本次已完成 0\/1/)).toBeTruthy();
  });
});
