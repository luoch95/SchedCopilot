import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { KnowledgeReport } from '../api/contracts';
import { TraceTree } from './TraceTree';

describe('lightweight trace tree', () => {
  it('nests role and knowledge execution and aggregates their tokens once', () => {
    const knowledge: KnowledgeReport = {
      status: 'matched',
      mode: 'live',
      message: '',
      sources: [],
      items: [],
      execution: {
        calls: 1,
        model: 'demo',
        elapsed_ms: 200,
        input_tokens: 20,
        output_tokens: 5,
        error_code: null,
        prompt_sha256: 'hash',
      },
    };
    render(
      <TraceTree
        traceId="TRC-TEST"
        steps={[
          {
            label: '结果解释',
            status: 'success',
            span_id: 'span-1',
            elapsed_ms: 1500,
            execution: {
              calls: 2,
              mode: 'live',
              elapsed_ms: 1200,
              input_tokens: 100,
              output_tokens: 30,
            },
            knowledge,
          },
        ]}
      />,
    );
    expect(screen.getByText('TRC-TEST')).toBeTruthy();
    const agent = screen.getByText('结果解释 Agent').closest('li')!;
    expect(within(agent).getByText('耗时 1.50 秒')).toBeTruthy();
    expect(within(agent).getByText('输入/输出 Token：120/35')).toBeTruthy();
    expect(agent.querySelectorAll(':scope > ol > li')).toHaveLength(2);
  });

  it('distinguishes unknown model usage, rule execution and failed execution', () => {
    render(
      <TraceTree
        steps={[
          {
            label: '模型',
            status: 'warning',
            execution: { calls: 1, elapsed_ms: 200, input_tokens: null },
          },
          { label: '规则', status: 'success', elapsed_ms: 12 },
          { label: '异常', status: 'failed', elapsed_ms: 15 },
        ]}
      />,
    );
    expect(screen.getByText('输入/输出 Token：未完整提供/未完整提供')).toBeTruthy();
    expect(screen.getByText(/规则工具执行.*Token：0\/0/)).toBeTruthy();
    const failed = screen.getByText('异常 Agent').closest('li')!;
    expect(within(failed).getByText('执行异常 · 模型调用及 Token 用量未记录')).toBeTruthy();
    expect(failed.textContent).not.toContain('规则工具执行');
  });
});
