import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { localInput } from '../shared/lib/time';
import { workbench, simulation } from '../test/fixtures';
import type { WorkflowResponse } from '../shared/api/contracts';

const workflowFixture: WorkflowResponse = {
  simulation,
  workflow: {
    id: 'workflow-1',
    intent: 'generate_candidates',
    status: 'completed',
    failure_code: null,
    trace: ['validate', 'schedule', 'evaluate', 'explain'].map((action) => ({
      action,
      status: 'warning',
      result_ref: action,
      error_code: null,
    })),
    results: {
      scheduling: { status: 'warning', warnings: [], errors: [], data: {} },
      evaluation: {
        status: 'warning',
        warnings: [
          {
            code: 'MISSING_METRICS',
            message: '缺少换型和班次数据，无法计算利用率。',
            repair_hint: '补充数据后重新评估',
            evidence_refs: ['metrics-1'],
          },
        ],
        errors: [],
        data: {
          evaluations: [
            {
              candidate_id: 'transfer',
              metrics_ref: 'metrics-1',
              missing_metrics: ['extra_changeovers', 'machine_utilization'],
            },
          ],
        },
      },
      explanation: {
        status: 'warning',
        warnings: [],
        errors: [],
        data: {
          summary: '已比较两个候选方案。',
          facts: [
            { text: '转移方案改变设备。', evidence_refs: ['metrics-1'] },
            {
              text: 'M1没有故障。因此将该工序转到M2，可提前15分钟开工。',
              evidence_refs: ['metrics-1'],
            },
          ],
        },
      },
    },
    evidence_catalog: { 'metrics-1': { kind: 'metrics', content: { extra_changeovers: null } } },
  },
};

let calls: { path: string; body?: Record<string, unknown> }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      const body = options?.body ? JSON.parse(String(options.body)) : undefined;
      calls.push({ path: url, body });
      let data: unknown = workbench;
      if (url === '/api/workflow') {
        data = workflowFixture;
        if (body.intent === 're_evaluate')
          data = {
            simulation: null,
            workflow: {
              ...workflowFixture.workflow,
              id: 'workflow-2',
              intent: 're_evaluate',
              trace: [workflowFixture.workflow.trace[2]],
              results: { ...workflowFixture.workflow.results, explanation: undefined },
            },
          };
        if (body.intent === 'explain')
          data = {
            simulation: null,
            workflow: {
              ...workflowFixture.workflow,
              id: 'workflow-3',
              intent: 'explain',
              trace: [workflowFixture.workflow.trace[3]],
            },
          };
      }
      if (url === '/api/decisions')
        data = {
          plan_version: 2,
          workbench: { ...workbench, baseline: simulation.candidates[1].schedule },
        };
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

describe('Schedule Copilot workflow', () => {
  it('runs a labelled one-shot fallback demo and keeps normal generation available in cooldown', async () => {
    const user = userEvent.setup();
    let triggered = false;
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      const status = {
        available: !triggered,
        remaining_seconds: triggered ? 1200 : 0,
        retry_at: triggered ? new Date(Date.now() + 1200000).toISOString() : null,
      };
      if (String(url) === '/api/workflow/demo') return new Response(JSON.stringify(status));
      if (String(url) === '/api/workflow' && JSON.parse(String(options?.body)).demo_fallback) {
        triggered = true;
        calls.push({ path: String(url), body: JSON.parse(String(options?.body)) });
        return new Response(
          JSON.stringify({
            ...workflowFixture,
            workflow: {
              ...workflowFixture.workflow,
              demo: {
                ...status,
                available: false,
                remaining_seconds: 1200,
                retry_at: new Date(Date.now() + 1200000).toISOString(),
              },
              trace: workflowFixture.workflow.trace.map((step) =>
                step.action === 'schedule'
                  ? {
                      ...step,
                      execution: {
                        mode: 'fallback',
                        model: null,
                        calls: 0,
                        input_tokens: null,
                        output_tokens: null,
                        elapsed_ms: 0,
                        error_code: 'DEMO_FALLBACK',
                        prompt_sha256: 'hash',
                        highlights: [],
                        simulated: true,
                      },
                    }
                  : step,
              ),
            },
          }),
        );
      }
      return originalFetch(url, options);
    });
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    await user.click(screen.getByText('兜底演示', { selector: 'summary' }));
    const checkbox = screen.getByRole('checkbox', {
      name: /下一次生成模拟排产/,
    }) as HTMLInputElement;
    await user.click(checkbox);
    await waitFor(() => expect(checkbox.checked).toBe(true));
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByText('排产执行：兜底演示（模拟）');
    await waitFor(() => expect(checkbox.checked).toBe(false));
    expect(checkbox.disabled).toBe(true);
    expect(calls.some((call) => call.body?.demo_fallback === true)).toBe(true);
    const generate = screen.getByRole('button', { name: /生成候选方案/ }) as HTMLButtonElement;
    expect(generate.disabled).toBe(false);
    await user.click(generate);
    await screen.findByRole('heading', { name: '方案比较' });
    expect(
      calls.filter((call) => call.path === '/api/workflow').at(-1)?.body?.demo_fallback,
    ).not.toBe(true);
  });

  it('cancels a pending generation without accepting late results and allows regeneration', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    let finish!: (response: Response) => void;
    let signal: AbortSignal | null | undefined;
    vi.mocked(fetch).mockImplementationOnce((_url, options) => {
      signal = options?.signal;
      // Simulate a response that arrives after cancellation despite the abort.
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      finish(
        new Response(JSON.stringify(workflowFixture), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await screen.findByText('工作流：已取消');
    expect(screen.queryByRole('heading', { name: '方案比较' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByRole('heading', { name: '方案比较' });
    expect(screen.getByText('工作流：已完成')).toBeTruthy();
  });

  it('updates only the active Agent from real streamed events and opens its completed details', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        controller = stream;
      },
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }),
    );
    const send = async (event: unknown) => {
      const bytes = new TextEncoder().encode(JSON.stringify(event) + '\n');
      await act(async () => {
        // Both NDJSON lines and UTF-8 characters can span transport chunks.
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      });
    };
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await send({ type: 'plan', actions: ['validate', 'schedule', 'evaluate', 'explain'] });
    await send({ type: 'stage_started', action: 'validate' });
    const stages = screen.getByLabelText('智能环节执行顺序');
    expect(stages.querySelectorAll('[data-status="running"]')).toHaveLength(1);
    expect(stages.children[0].getAttribute('aria-current')).toBe('step');
    expect(within(stages).getAllByText('等待前序环节')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: '查看数据校验详情' })).toBeNull();
    await send({ type: 'quality_phase', action: 'validate', phase: 'checking', round: 1 });
    expect(within(stages).getByText('检查中 · 第 1/3 轮')).toBeTruthy();
    await send({
      type: 'quality_checked',
      action: 'validate',
      round: 1,
      outcome: 'failed',
      issues: [{ code: 'COVERAGE', message: '检查覆盖遗漏', repairable: true }],
    });
    expect(stages.children[0].getAttribute('data-status')).toBe('running');
    expect(screen.queryByRole('button', { name: '查看数据校验详情' })).toBeNull();
    await send({ type: 'quality_phase', action: 'validate', phase: 'repairing', round: 2 });
    expect(within(stages).getByText('修正中 · 第 2/3 轮')).toBeTruthy();
    expect(stages.children[1].getAttribute('data-status')).toBe('pending');
    await send({ type: 'quality_phase', action: 'validate', phase: 'checking', round: 2 });
    expect(within(stages).getByText('检查中 · 第 2/3 轮')).toBeTruthy();
    await send({
      type: 'stage_completed',
      action: 'validate',
      name: 'validation',
      step: { ...workflowFixture.workflow.trace[0], status: 'success' },
      report: {
        status: 'success',
        warnings: [],
        errors: [],
        data: {},
        quality: {
          version: 'AGD-V1.3-I1',
          outcome: 'passed',
          round: 2,
          issues: [],
          stop_reason: '检查通过',
          history: [
            {
              round: 1,
              issues: [{ code: 'COVERAGE', message: '检查覆盖遗漏', repairable: true }],
              repair: null,
            },
            { round: 2, issues: [], repair: '按原始快照重建校验覆盖' },
          ],
        },
      },
    });
    await send({ type: 'stage_started', action: 'schedule' });
    expect(stages.children[0].getAttribute('data-status')).toBe('success');
    expect(stages.children[1].getAttribute('data-status')).toBe('running');
    expect(stages.querySelectorAll('[data-status="running"]')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '查看数据校验详情' }));
    expect(document.activeElement?.tagName).toBe('ARTICLE');
    expect(document.activeElement?.closest('details')?.open).toBe(true);
    expect(screen.getByRole('heading', { name: '输出质量检查' })).toBeTruthy();
    expect(screen.getByText(/第 1 轮：检查覆盖遗漏/)).toBeTruthy();
    expect(screen.getByText(/第 2 轮：按原始快照重建校验覆盖；检查通过/)).toBeTruthy();
    await send({ type: 'result', data: workflowFixture });
    await act(async () => controller.close());
    await screen.findByRole('heading', { name: '方案比较' });
    expect(stages.querySelectorAll('[data-status="running"]')).toHaveLength(0);
    expect(screen.getByText('工作流：已完成')).toBeTruthy();
  });

  it.each(['live', 'fallback'] as const)(
    'displays model mode %s and retains the authoritative explanation',
    async (mode) => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole('heading', { name: '当前正式计划' });
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...workflowFixture,
            workflow: {
              ...workflowFixture.workflow,
              trace: workflowFixture.workflow.trace.map((step) => ({
                ...step,
                execution: {
                  mode,
                  model: 'test-provider',
                  calls: 2,
                  input_tokens: null,
                  output_tokens: null,
                  elapsed_ms: 500,
                  error_code: mode === 'fallback' ? 'MODEL_UNAVAILABLE' : null,
                  prompt_sha256: 'prompt-hash',
                  highlights:
                    mode === 'live'
                      ? [{ text: '计划员核实恢复时间。', evidence_refs: ['metrics-1'] }]
                      : [],
                },
              })),
            },
          }),
        ),
      );
      await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
      await screen.findByText('工作流：已完成');
      expect(
        within(screen.getByLabelText('智能环节执行顺序')).getAllByText(
          mode === 'live' ? '模型辅助' : '规则回退',
        ),
      ).toHaveLength(4);
      expect(screen.getByText('已比较两个候选方案。')).toBeTruthy();
      expect(screen.getByText('转移方案改变设备。')).toBeTruthy();
      if (mode === 'live') {
        expect(screen.getByRole('heading', { name: '本次分析重点' })).toBeTruthy();
        expect(
          within(screen.getByLabelText('辅助分析')).getByText('计划员核实恢复时间。'),
        ).toBeTruthy();
      } else {
        expect(screen.getByLabelText('模型辅助执行情况')).toBeTruthy();
        expect(screen.getByText(/模型辅助已完成 0\/4/)).toBeTruthy();
        expect(screen.queryByRole('heading', { name: '本次分析重点' })).toBeNull();
      }
      expect(screen.getAllByText(/输入\/输出 Token：未提供\/未提供/)).toHaveLength(4);
    },
  );

  it('groups evidence per candidate and keeps raw data in nested debug details', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByRole('heading', { name: '方案计算依据' });
    expect(screen.queryAllByText(/^查看依据/)).toHaveLength(0);
    expect(screen.getAllByText('查看计算依据')).toHaveLength(2);
    const basis = screen.getByLabelText('允许合格设备转移计算依据') as HTMLDetailsElement;
    expect(basis.open).toBe(false);
    await user.click(within(basis).getByText('查看计算依据'));
    expect(basis.open).toBe(true);
    expect(within(basis).getByText('计算口径')).toBeTruthy();
    const debug = within(basis).getByText('调试详情').closest('details')!;
    expect(debug.open).toBe(false);
    await user.click(within(basis).getByText('调试详情'));
    expect(debug.open).toBe(true);
    expect(debug.querySelector('pre')?.textContent).toContain('metrics-1');
    expect(debug.querySelector('pre')?.textContent).toContain('"extra_changeovers": null');
    const explanation = screen.getByRole('region', { name: '辅助分析' });
    expect(within(explanation).getByText('转移方案改变设备。')).toBeTruthy();
    expect(within(explanation).getByText('因此将该工序转到M2，可提前15分钟开工。').tagName).toBe(
      'STRONG',
    );
    expect(within(explanation).getByText('已比较两个候选方案。').tagName).toBe('STRONG');
    expect(within(explanation).queryByText('调试详情')).toBeNull();
    expect(screen.getAllByText('缺少换型和班次数据，无法计算利用率。').length).toBeGreaterThan(0);
  });

  it('can validate unknown recovery without fabricating candidates or running other stages', async () => {
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      if (args[0] === '/api/workbench')
        return new Response(
          JSON.stringify({ ...workbench, event: { ...workbench.event, recovered_at: null } }),
        );
      if (args[0] === '/api/workflow') {
        calls.push({ path: '/api/workflow', body: JSON.parse(String(args[1]?.body)) });
        return new Response(
          JSON.stringify({
            simulation: null,
            workflow: {
              ...workflowFixture.workflow,
              intent: 'validate',
              status: 'blocked',
              trace: [{ action: 'validate', status: 'blocked', error_code: 'RECOVERY_REQUIRED' }],
              results: {
                validation: {
                  status: 'blocked',
                  warnings: [],
                  errors: [
                    {
                      code: 'RECOVERY_REQUIRED',
                      message: '请补充预计恢复时间。',
                      repair_hint: '填写并保存后重新生成方案',
                      evidence_refs: [],
                    },
                  ],
                  data: null,
                },
              },
            },
          }),
        );
      }
      return baseFetch(...args);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    expect(
      (screen.getByRole('button', { name: /生成候选方案/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByText('执行详情', { exact: true }));
    await user.click(screen.getByRole('button', { name: '仅校验数据' }));
    await screen.findByText('工作流：已阻断');
    expect(calls.find((call) => call.path === '/api/workflow')?.body?.intent).toBe('validate');
    expect(screen.getByText('请补充预计恢复时间。')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '方案比较' })).toBeNull();
    expect(screen.getByLabelText('智能环节执行顺序').children).toHaveLength(1);
  });

  it('re-explains the same batch without scheduling again or losing comparison', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByRole('heading', { name: '辅助分析' });
    await user.click(screen.getByText('针对已有结果提问', { exact: true }));
    await user.clear(screen.getByLabelText('解释问题'));
    await user.type(screen.getByLabelText('解释问题'), '解释设备转移风险');
    await user.click(screen.getByRole('button', { name: '重新解释' }));
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/workflow')).toHaveLength(2));
    expect(calls.filter((c) => c.path === '/api/workflow')[1].body).toMatchObject({
      intent: 'explain',
      workflow_id: 'workflow-1',
      question: '解释设备转移风险',
    });
    expect(screen.getByRole('heading', { name: '方案比较' })).toBeTruthy();
    expect(calls.filter((c) => c.body?.intent === 'generate_candidates')).toHaveLength(1);
  });

  it('does not invent completed stages while the workflow response is pending', async () => {
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      if (args[0] === '/api/workflow')
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return baseFetch(...args);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    expect(screen.getAllByText('等待结果中').length).toBeGreaterThan(0);
    expect(screen.queryByText('工作流：已完成')).toBeNull();
    const stages = screen.getByLabelText('智能环节执行顺序');
    expect(within(stages).getAllByText('等待前序环节')).toHaveLength(3);
    expect(within(stages).getByText('等待后台开始')).toBeTruthy();
    expect(stages.querySelectorAll('[data-status="running"]')).toHaveLength(0);
    expect(screen.getByText('等待结果中').querySelector('.waiting-dots')?.children).toHaveLength(6);
    fireEvent(window, new Event('blur'));
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('focus'));
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/workflow')).toHaveLength(1);
    finish(new Response(JSON.stringify(workflowFixture)));
    await screen.findByText('工作流：已完成');
  });

  it('keeps results and inputs on tab focus and loads new data only on manual reload', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByRole('heading', { name: '当前正式计划' });
    expect(calls.filter((call) => call.path === '/api/workbench')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByRole('heading', { name: '方案比较' });
    await user.type(screen.getByLabelText('解释问题'), '关注延期');
    const question = (screen.getByLabelText('解释问题') as HTMLTextAreaElement).value;
    fireEvent(window, new Event('blur'));
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('pageshow'));
    fireEvent(window, new Event('focus'));
    expect(screen.getByRole('heading', { name: '方案比较' })).toBeTruthy();
    expect((screen.getByLabelText('解释问题') as HTMLTextAreaElement).value).toBe(question);
    expect(calls.filter((call) => call.path === '/api/workbench')).toHaveLength(1);
    expect(calls.filter((call) => call.path === '/api/workflow')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '重新载入已保存事件' }));
    await screen.findByText('已载入后台最新记录，未保存输入已清除。');
    expect(calls.filter((call) => call.path === '/api/workbench')).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: '方案比较' })).toBeNull();
  });

  it('identifies the exact model fallback and completed Agents without implying total failure', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...workflowFixture,
          workflow: {
            ...workflowFixture.workflow,
            trace: workflowFixture.workflow.trace.map((step) => ({
              ...step,
              execution: {
                mode: step.action === 'explain' ? 'fallback' : 'live',
                model: 'test-model',
                calls: 2,
                input_tokens: null,
                output_tokens: null,
                elapsed_ms: 1000,
                error_code: step.action === 'explain' ? 'MODEL_TIMEOUT' : null,
                prompt_sha256: 'hash',
                highlights: [],
              },
            })),
          },
        }),
      ),
    );
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    const notice = await screen.findByLabelText('模型辅助执行情况');
    expect(notice.textContent).toContain(
      '模型辅助已完成 3/4 个智能环节：数据校验、排产执行、方案评估',
    );
    expect(within(notice).getAllByRole('listitem')).toHaveLength(1);
    expect(notice.textContent).toContain('结果解释：模型辅助未完成');
    expect(notice.textContent).toContain('模型请求超时');
    expect(notice.textContent).toContain('模板解释已完成');
    expect(screen.getByText(/本次已完成 4\/4/)).toBeTruthy();
  });

  it('reports an exception at the correct stage when no Agent result was recorded', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          simulation: null,
          workflow: {
            ...workflowFixture.workflow,
            status: 'failed',
            failure_code: 'WORKFLOW_AGENT_FAILED',
            results: {},
            trace: [
              {
                action: 'validate',
                status: 'failed',
                result_ref: null,
                error_code: 'WORKFLOW_AGENT_FAILED',
              },
            ],
          },
        }),
      ),
    );
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByText('工作流：失败');
    const stages = screen.getByLabelText('智能环节执行顺序');
    expect(within(stages).getByText('失败')).toBeTruthy();
    expect(within(stages).getAllByText('未执行（前序阻断或失败）')).toHaveLength(3);
    expect(screen.queryByRole('heading', { name: '方案比较' })).toBeNull();
  });

  it('runs four Agents, displays warnings and routes generated candidates to human publication', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    expect(screen.getAllByRole('button', { name: /生成候选方案/ })).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: '四 Agent 动态编排' })).toBeNull();
    expect(screen.queryByRole('button', { name: '生成并评估方案' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByText('工作流：已完成');
    expect(screen.getByLabelText('智能环节执行顺序').children).toHaveLength(4);
    expect(
      within(screen.getByLabelText('方案评估结果')).getByText(
        '缺少换型和班次数据，无法计算利用率。',
      ),
    ).toBeTruthy();
    const evaluation = screen.getByRole('table', { name: '方案评估对比表' });
    const missing = within(evaluation).getByRole('row', { name: /缺失指标/ });
    expect(within(missing).getByText('新增换型次数、班次利用率')).toBeTruthy();
    expect(screen.getByText('已比较两个候选方案。')).toBeTruthy();
    await screen.findByRole('heading', { name: '方案比较' });
    expect(calls.find((c) => c.path === '/api/workflow')?.body?.intent).toBe('generate_candidates');
    expect(calls.some((c) => c.path === '/api/decisions')).toBe(false);
    expect(calls.some((c) => ['/api/simulations', '/api/analysis'].includes(c.path))).toBe(false);
    expect(screen.queryByText('启用 API 多 Agent')).toBeNull();
    expect(screen.getByRole('heading', { name: '辅助分析' })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('本次处理的方案'), 'transfer');
    await user.selectOptions(screen.getByLabelText('处理方式'), 'publish');
    await user.type(screen.getByLabelText('确认理由（必填）'), '确认发布');
    await user.click(screen.getByRole('button', { name: '确认并发布所选方案' }));
    await screen.findByText('已发布方案，正式计划版本 V2。');
    expect(screen.queryByText('工作流：已完成')).toBeNull();
    expect(screen.queryByRole('heading', { name: '辅助分析' })).toBeNull();
  });

  it('reuses the workflow identifier for evaluation and clears it on unsaved edits', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    await user.click(screen.getByText('执行详情', { exact: true }));
    expect(
      (screen.getByRole('button', { name: '重新评估已有方案' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByText('工作流：已完成');
    await user.click(screen.getByRole('button', { name: '重新评估已有方案' }));
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/workflow')).toHaveLength(2));
    expect(calls.filter((c) => c.path === '/api/workflow')[1].body).toMatchObject({
      intent: 're_evaluate',
      workflow_id: 'workflow-1',
    });
    await screen.findByText('评估已更新，可点击“重新解释”查看最新说明。');
    expect(screen.queryByText('已比较两个候选方案。')).toBeNull();
    expect(screen.getByRole('heading', { name: '方案比较' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('预计恢复时间'), {
      target: { value: '2026-10-19T18:00' },
    });
    expect(screen.queryByText('工作流：已完成')).toBeNull();
    expect(
      (screen.getByRole('button', { name: /生成候选方案/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('displays the blocking explanation instead of candidates when generation is blocked', async () => {
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      if (args[0] === '/api/workflow')
        return new Response(
          JSON.stringify({
            simulation: null,
            workflow: {
              ...workflowFixture.workflow,
              status: 'blocked',
              trace: [
                { action: 'validate', status: 'blocked' },
                { action: 'explain', status: 'success' },
              ],
              results: {
                explanation: {
                  status: 'success',
                  warnings: [],
                  errors: [],
                  data: { summary: '预计恢复时间未知，请人工补充。' },
                },
              },
            },
          }),
        );
      return baseFetch(...args);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByText('工作流：已阻断');
    expect(screen.getByText('预计恢复时间未知，请人工补充。')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '方案比较' })).toBeNull();
  });

  it('shows the rescheduled waiting candidate as reference and publishes a server-owned candidate', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByRole('heading', { name: '方案比较' });
    expect(screen.getAllByRole('img', { name: '设备工序甘特图' })).toHaveLength(3);
    const reference = within(screen.getByLabelText('原计划对照排产图')).getByRole('img');
    const published = screen.getAllByRole('img', { name: '设备工序甘特图' })[0];
    expect(reference.outerHTML).not.toBe(published.outerHTML);
    expect(
      within(reference).getByRole('graphics-symbol', { name: /17:00.*18:00.*时间调整/ }),
    ).toBeTruthy();
    expect(screen.queryByRole('graphics-symbol', { name: /^原安排/ })).toBeNull();
    expect(within(screen.getByLabelText('本次处理的方案')).getByText('原计划对照')).toBeTruthy();
    expect(document.querySelectorAll('rect[stroke="#7C3AED"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.evidence-cell')).toHaveLength(2);
    await user.selectOptions(screen.getByLabelText('本次处理的方案'), 'transfer');
    await user.selectOptions(screen.getByLabelText('处理方式'), 'publish');
    await user.type(screen.getByLabelText('确认理由（必填）'), '接受设备转移');
    await user.click(screen.getByRole('button', { name: '确认并发布所选方案' }));
    await screen.findByText('已发布方案，正式计划版本 V2。');
    const decision = calls.find((call) => call.path === '/api/decisions')!.body!;
    expect(decision.candidate_id).toBe('transfer');
    expect(decision.simulation_id).toBe('batch-1');
    expect(decision).not.toHaveProperty('schedule');
    expect(screen.queryByRole('heading', { name: '方案比较' })).toBeNull();
  });

  it('invalidates visible candidates immediately on unsaved event edits', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByRole('heading', { name: '方案比较' });
    fireEvent.change(screen.getByLabelText('预计恢复时间'), {
      target: { value: '2026-10-19T18:00' },
    });
    expect(screen.queryByRole('heading', { name: '方案比较' })).toBeNull();
    expect(
      (screen.getByRole('button', { name: /生成候选方案/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: '保存故障事件' }));
    await waitFor(() => expect(calls.some((call) => call.path === '/api/event')).toBe(true));
    const saved = calls.find((call) => call.path === '/api/event')!.body!;
    expect(saved.event_revision).toBe(1);
    expect(saved.recovered_at).toBe('2026-10-19T18:00:00+08:00');
  });

  it('surfaces stale versions and requires reload before continuing', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: '事件或计划已更新，请重新载入后操作' }), {
        status: 409,
      }),
    );
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByText('后台事件或计划已更新，请点击“重新载入已保存事件”后继续。');
    expect(
      (screen.getByRole('button', { name: /生成候选方案/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: '重新载入已保存事件' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: /生成候选方案/ }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });

  it('always formats editor times in the workshop timezone', () => {
    expect(localInput('2026-10-19T05:00:00Z')).toBe('2026-10-19T13:00');
  });

  it('saves unknown recovery and restores a usable event without losing the plan', async () => {
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      const response = await baseFetch(...args);
      if (args[0] === '/api/event')
        return new Response(
          JSON.stringify({
            ...workbench,
            event_revision: 2,
            event: { ...workbench.event, recovered_at: null },
          }),
          { status: 200 },
        );
      return response;
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    await user.click(screen.getByLabelText('恢复时间未知'));
    expect(screen.queryByLabelText('预计恢复时间')).toBeNull();
    await user.click(screen.getByRole('button', { name: '保存故障事件' }));
    await screen.findByText('故障事件已保存。请重新生成候选方案，正式计划未改变。');
    expect(
      (screen.getByRole('button', { name: /生成候选方案/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(calls.find((call) => call.path === '/api/event')!.body!.recovered_at).toBeNull();
    await user.click(screen.getByRole('button', { name: '恢复上次可试算事件' }));
    await screen.findByText('已恢复可试算事件。正式计划与历史记录均保留。');
    expect(screen.getByLabelText('预计恢复时间')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByRole('heading', { name: '方案比较' });
  });

  it('records a rejection while preserving the visible comparison and formal plan', async () => {
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      const response = await baseFetch(...args);
      if (args[0] === '/api/decisions')
        return new Response(
          JSON.stringify({
            plan_version: 1,
            workbench: {
              ...workbench,
              history: [
                {
                  id: 1,
                  action: 'reject',
                  reason: '等待维修确认',
                  created_at: workbench.snapshot_time,
                },
              ],
            },
          }),
          { status: 200 },
        );
      return response;
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByRole('heading', { name: '方案比较' });
    await user.type(screen.getByLabelText('确认理由（必填）'), '等待维修确认');
    await user.click(screen.getByRole('button', { name: '记录暂不发布' }));
    await screen.findByText('已记录暂不发布，正式计划保持不变。');
    expect(screen.getByRole('heading', { name: '方案比较' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '等待维修确认' })).toBeTruthy();
    expect(calls.find((call) => call.path === '/api/decisions')!.body!.action).toBe('reject');
  });

  it('reuses the idempotency key when retrying a failed publication response', async () => {
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    let lostResponse = false;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      if (args[0] === '/api/decisions' && !lostResponse) {
        lostResponse = true;
        calls.push({ path: '/api/decisions', body: JSON.parse(String(args[1]?.body)) });
        throw new TypeError('connection lost');
      }
      return baseFetch(...args);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前正式计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案/ }));
    await screen.findByRole('heading', { name: '方案比较' });
    await user.selectOptions(screen.getByLabelText('本次处理的方案'), 'transfer');
    await user.selectOptions(screen.getByLabelText('处理方式'), 'publish');
    await user.type(screen.getByLabelText('确认理由（必填）'), '确认转移');
    await user.click(screen.getByRole('button', { name: '确认并发布所选方案' }));
    await screen.findByText('无法连接后端。请确认 FastAPI 已在 8000 端口启动。');
    await user.click(screen.getByRole('button', { name: '确认并发布所选方案' }));
    await screen.findByText('已发布方案，正式计划版本 V2。');
    const decisions = calls.filter((call) => call.path === '/api/decisions');
    expect(decisions).toHaveLength(2);
    expect(decisions[0].body!.request_id).toBe(decisions[1].body!.request_id);
  });
});
