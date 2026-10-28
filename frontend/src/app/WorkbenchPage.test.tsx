import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './WorkbenchPage';
import { evidenceEntries } from './FaultDecisionEvidence';
import { localInput } from '../shared/lib/time';
import { workbench, simulation } from '../test/fixtures';
import type { WorkflowResponse } from '../shared/api/contracts';

vi.mock('../features/sales', () => ({ PendingRequestsPanel: () => null }));

const workflowFixture: WorkflowResponse = {
  simulation,
  workflow: {
    id: 'workflow-1',
    trace_id: 'TRC-TEST-RESTORE',
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

async function openFaultEditor() {
  if (screen.queryByRole('heading', { name: '故障影响与方案决策', level: 1 })) {
    fireEvent.click(screen.getByRole('button', { name: '← 工作台总览' }));
    await screen.findByRole('heading', { name: '排产计划工作台' });
  }
  fireEvent.click(screen.getByRole('button', { name: '+ 录入设备故障' }));
}

beforeEach(() => {
  history.replaceState(
    {
      'sched-copilot.planner-navigation.v1': {
        route: { view: 'fault', eventOpen: false, request: null },
        depth: 1,
      },
    },
    '',
  );
  const faultEntry = history.state;
  history.replaceState(
    {
      'sched-copilot.planner-navigation.v1': {
        route: { view: 'dashboard', eventOpen: false, request: null },
        depth: 0,
      },
    },
    '',
  );
  history.pushState(faultEntry, '');
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      const body = options?.body ? JSON.parse(String(options.body)) : undefined;
      calls.push({ path: url, body });
      let data: unknown = url === '/api/sales/requests' ? [] : workbench;
      if (url === '/api/workflow/latest') data = null;
      if (url === '/api/workbench')
        data = {
          ...workbench,
          fault_review: {
            id: 'review-test',
            simulation_id: simulation.id,
            candidate_id: 'transfer',
            status: 'approved',
            reason: 'submitted',
            review_reason: 'approved',
          },
        };

      if (url === '/api/copilot/ask')
        data = {
          workflow_id: 'workflow-1',
          question: body.question,
          answer: '## 风险解答\n\n**转移需要人工确认。**',
          mode: 'fallback',
          knowledge: { message: '规则依据', sources: [] },
        };
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
          workbench: {
            ...workbench,
            baseline: simulation.candidates[1].schedule,
            affected: [],
            plan_publication: {
              version: 2,
              published_at: '2026-10-19T06:00:00Z',
              published_by: 'planner_01',
              version_summary: '故障调整',
              fault_analysis: {
                event_revision: workbench.event_revision,
                baseline_version: 1,
                affected: workbench.affected,
                workflow: workflowFixture.workflow,
                baseline: workbench.baseline,
                simulation,
                selected_variant: 'ai',
                selected_candidate_id: 'transfer',
                published_version: 2,
              },
            },
          },
        };
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

describe('Schedule Copilot workflow', () => {
  it.each(['available', 'missing', 'mismatched', 'failed'])(
    'loads published fault details from an overview response: %s',
    async (mode) => {
      const original = vi.mocked(fetch).getMockImplementation()!;
      let resolveArchive!: (response: Response) => void;
      const archiveResponse = new Promise<Response>((resolve) => {
        resolveArchive = resolve;
      });
      vi.mocked(fetch).mockImplementation(async (...args) => {
        if (args[0] === '/api/workbench')
          return new Response(
            JSON.stringify({
              ...workbench,
              baseline: { ...workbench.baseline, version: 2 },
              plan_publication: {
                version: 2,
                published_at: '2026-10-19T06:00:00Z',
                published_by: 'planner_01',
                version_summary: '故障调整',
                fault_traces: [
                  {
                    version: 2,
                    event_revision: workbench.event_revision,
                    failure: workbench.event,
                  },
                ],
              },
            }),
          );
        if (args[0] === `/api/events/${workbench.event_revision}/analysis`) return archiveResponse;
        return original(...args);
      });
      render(<App />);
      await screen.findByText('正在加载历史评估方案…');
      expect(screen.queryByRole('button', { name: /生成评估方案|提交管理者审批/ })).toBeNull();
      await act(async () => {
        resolveArchive(
          new Response(
            JSON.stringify(
              mode === 'missing'
                ? null
                : {
                    event_revision:
                      mode === 'mismatched'
                        ? workbench.event_revision + 1
                        : workbench.event_revision,
                    baseline_version: workbench.baseline.version,
                    baseline: workbench.baseline,
                    affected: workbench.affected,
                    workflow: workflowFixture.workflow,
                    simulation,
                    selected_variant: 'ai',
                    selected_candidate_id: 'transfer',
                    published_version: 2,
                  },
            ),
            { status: mode === 'failed' ? 500 : 200 },
          ),
        );
      });
      if (mode === 'available') {
        const archive = await screen.findByLabelText('已发布故障方案存档');
        expect(within(archive).getByText('原 AI 方案 · 历史分析存档')).toBeTruthy();
        expect(within(archive).getByRole('heading', { name: '3　候选排产计划' })).toBeTruthy();
        expect(archive.querySelectorAll('.gantt').length).toBeGreaterThan(0);
        expect(screen.queryByText('方案尚未生成，请确认故障信息后生成候选。')).toBeNull();
      } else {
        await screen.findByRole('alert');
        expect(screen.queryByText('原 AI 方案 · 历史分析存档')).toBeNull();
      }
      expect(
        screen.queryByRole('button', { name: /生成评估方案|提交管理者审批|发布计划|手动调整/ }),
      ).toBeNull();
    },
  );

  it('shares published card layout and keeps each fault publication metrics and permissions separate', async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      if (args[0] === '/api/workbench')
        return new Response(
          JSON.stringify({
            ...workbench,
            baseline: { ...workbench.baseline, version: 3 },
            event_history: [
              ...[0, -1, -2].map((revision) => ({
                ...workbench.event,
                machine_id: revision === 0 ? 'M2' : 'M3',
                fault_business_code:
                  revision === 0 ? 'M2-GZ01' : revision === -1 ? 'M3-GZ01' : 'M3-GZ02',
                started_at:
                  revision === -2 ? '2026-10-18T13:00:00+08:00' : workbench.event.started_at,
                revision,
                created_at: workbench.snapshot_time,
              })),
              {
                ...workbench.event,
                revision: -3,
                created_at: workbench.snapshot_time,
              },
              {
                ...workbench.event,
                machine_id: 'M2',
                started_at: new Date(workbench.event.started_at).toISOString(),
                revision: -4,
                created_at: workbench.snapshot_time,
              },
            ],
            plan_publication: {
              version: 3,
              published_at: '2026-10-19T06:00:00Z',
              published_by: 'planner_01',
              version_summary: '故障调整',
              current_fault_analysis: {
                event_revision: workbench.event_revision,
                baseline_version: 1,
                baseline: workbench.baseline,
                affected: workbench.affected,
                simulation,
                workflow: workflowFixture.workflow,
                selected_variant: 'ai',
                selected_candidate_id: 'transfer',
                published_version: 3,
              },
              fault_traces: [
                {
                  version: 2,
                  event_revision: 0,
                  failure: { ...workbench.event, machine_id: 'M2' },
                  affected_operations: [],
                  candidate_label: '人工调整方案',
                  metrics: {
                    ...simulation.candidates[1].metrics,
                    late_orders: 2,
                    total_lateness_minutes: 215,
                    moved_operations: 3,
                  },
                },
                {
                  version: 1,
                  event_revision: -1,
                  failure: { ...workbench.event, machine_id: 'M3' },
                  affected_operations: [],
                },
              ],
            },
          }),
        );
      return original(...args);
    });
    render(<App />);
    await screen.findByRole('heading', { name: '故障影响与方案决策', level: 1 });
    fireEvent.click(screen.getByRole('button', { name: '← 工作台总览' }));
    const current = await screen.findByRole('article', { name: '已登记设备故障' });
    const historical = screen.getByRole('article', { name: '历史故障 M2-GZ01-001' });
    const missingMetrics = screen.getByRole('article', { name: '历史故障 M3-GZ01-001' });
    for (const card of [current, historical, missingMetrics]) {
      expect(card.className).toBe('fault-event-banner is-published');
      expect(within(card).getAllByRole('listitem')).toHaveLength(4);
      expect(card.querySelectorAll('.fault-progress .is-complete')).toHaveLength(4);
      expect(within(card).queryByRole('button', { name: /撤销|删除|重新生成/ })).toBeNull();
    }
    expect(
      within(current).getByText(
        /已发布原 AI 方案；调整 1 道工序，.*预计 0 个订单延期，共 0 分钟。/,
      ),
    ).toBeTruthy();
    expect(
      within(historical).getByText(
        '已发布人工调整方案；调整 3 道工序，预计 2 个订单延期，共 215 分钟。',
      ),
    ).toBeTruthy();
    expect(
      within(historical).getByRole('heading', { name: /M2 停机 · M2-GZ01-004 · 已发布 V2/ }),
    ).toBeTruthy();
    expect(within(historical).getByRole('button', { name: '查看历史 AI 分析' })).toBeTruthy();
    expect(within(missingMetrics).getByText(/历史指标记录缺失/)).toBeTruthy();
    expect(within(missingMetrics).queryByText(/总延期 0/)).toBeNull();
    const unpublished = screen.getByRole('article', { name: '历史故障 M3-GZ02-001' });
    expect(unpublished.className).toBe('fault-history-item');
    expect(within(unpublished).getByRole('button', { name: '撤销' })).toBeTruthy();
    expect(within(unpublished).queryByText(/已发布|已批准/)).toBeNull();
    expect(screen.queryByRole('article', { name: '历史故障 M1 · 编号缺失' })).toBeNull();
    expect(screen.queryByRole('article', { name: '历史故障 M2 · 编号缺失' })).toBeNull();
    expect(screen.getAllByRole('button', { name: '撤销' })).toHaveLength(1);
  });

  it('shows actions for a saved non-current fault event and targets its revision', async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      if (args[0] === '/api/workbench')
        return new Response(
          JSON.stringify({
            ...workbench,
            event_history: [
              {
                ...workbench.event,
                machine_id: 'M1',
                started_at: '2026-10-19T12:00:00+08:00',
                revision: 0,
                event_status: 'registered',
                created_at: workbench.snapshot_time,
              },
            ],
          }),
        );
      return original(...args);
    });
    render(<App />);
    await screen.findByRole('heading', { name: '故障影响与方案决策', level: 1 });
    fireEvent.click(screen.getByRole('button', { name: '← 工作台总览' }));
    const event = await screen.findByRole('article', { name: '待处理故障 M1 · 编号缺失' });
    expect(within(event).getByRole('button', { name: '撤销' })).toBeTruthy();
    expect(within(event).getByRole('button', { name: 'AI生成评估方案' })).toBeTruthy();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(within(event).getByRole('button', { name: '撤销' }));
    await waitFor(() => {
      expect(calls.some((call) => call.path === '/api/events/0/cancel')).toBe(true);
    });
  });

  it('keeps historical fault reports in a read-only drawer without generating again', async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      if (args[0] === '/api/workbench')
        return new Response(
          JSON.stringify({
            ...workbench,
            event_history: [
              {
                ...workbench.event,
                machine_id: 'M2',
                revision: 0,
                created_at: workbench.snapshot_time,
              },
            ],
          }),
        );
      if (args[0] === '/api/events/0/analysis')
        return new Response(
          JSON.stringify({
            event_revision: 0,
            baseline_version: 1,
            baseline: workbench.baseline,
            affected: workbench.affected,
            workflow: workflowFixture.workflow,
            simulation,
          }),
        );
      return original(...args);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '故障影响与方案决策', level: 1 });
    await user.click(screen.getByRole('button', { name: '← 工作台总览' }));
    await user.click(await screen.findByRole('button', { name: '查看历史 AI 分析' }));
    const drawer = await screen.findByRole('dialog', { name: 'M2 · 编号缺失 · 历史智能分析明细' });
    await within(drawer).findByText('工作流：已完成');
    expect(within(drawer).getAllByRole('img', { name: '设备工序甘特图' })).toHaveLength(2);
    expect(within(drawer).queryByRole('button', { name: /采纳|发布|生成|提交审批/ })).toBeNull();
    expect(calls.some((call) => call.path === '/api/workflow')).toBe(false);
    await user.click(within(drawer).getByRole('button', { name: '关闭' }));
    expect(screen.getByRole('heading', { name: '排产计划工作台' })).toBeTruthy();
  });

  it('opens AI details when an older published fault has only a legacy report', async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      if (args[0] === '/api/workbench')
        return new Response(
          JSON.stringify({
            ...workbench,
            plan_publication: {
              version: workbench.baseline.version,
              published_at: null,
              published_by: null,
              version_summary: '上一故障已发布',
              fault_analysis: {
                event_revision: 0,
                baseline_version: 0,
                affected: [],
                workflow: null,
                report: { manual_summary: '上一故障历史报告', decision: '已发布' },
              },
            },
          }),
        );
      if (args[0] === '/api/workflow/latest') return new Response(JSON.stringify(workflowFixture));
      return original(...args);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '故障影响与方案决策', level: 1 });
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
    await screen.findAllByText('已比较两个候选方案。');
    await user.click(screen.getByRole('button', { name: '← 工作台总览' }));
    await user.click(
      await screen.findByRole('button', { name: '查看 AI 分析详情' }, { timeout: 5000 }),
    );
    await screen.findByRole('heading', { name: '故障影响与方案决策', level: 1 });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByText('已比较两个候选方案。').length).toBeGreaterThan(0);
    expect(screen.queryByText('上一故障历史报告')).toBeNull();
    expect(screen.getAllByRole('img', { name: '设备工序甘特图' }).length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((c) => c.path === '/api/workflow')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '← 工作台总览' }));
    expect(screen.getByRole('heading', { name: '排产计划工作台' })).toBeTruthy();
  });

  it('returns an approved fault to the planner and publishes from its approval details', async () => {
    const review = {
      id: 'approved-review',
      simulation_id: simulation.id,
      candidate_id: 'transfer',
      event_revision: workbench.event_revision,
      baseline_fingerprint: workbench.baseline.fingerprint,
      status: 'approved',
      reason: '现场已核对',
      review_reason: '同意转移方案，由排产员发布',
      candidate_label: '转移方案',
      reviewed_at: workbench.snapshot_time,
    };
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      if (args[0] === '/api/workbench')
        return new Response(JSON.stringify({ ...workbench, fault_review: review }));
      if (args[0] === '/api/workflow/latest') return new Response(JSON.stringify(workflowFixture));
      const response = await original(...args);
      if (args[0] === '/api/decisions') {
        const result = await response.json();
        result.workbench.fault_review = { ...review, status: 'published' };
        return new Response(JSON.stringify(result));
      }
      return response;
    });
    history.replaceState(
      {
        'sched-copilot.planner-navigation.v1': {
          route: { view: 'dashboard', eventOpen: false, request: null },
          depth: 0,
        },
      },
      '',
      '#/planner',
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('计划发布：已流转排产员 · 待发布');
    await user.click(screen.getByRole('button', { name: '审批详情' }));
    const details = await screen.findByRole('region', { name: '审批结果与计划发布' });
    expect(location.hash).toBe('#/planner/fault-decision/approval-result');
    expect(details.textContent).toContain(review.review_reason);
    expect((within(details).getByLabelText('本次处理的方案') as HTMLSelectElement).value).toBe(
      'transfer',
    );
    await user.type(
      within(details).getByLabelText('确认理由（必填）'),
      '已确认，发布审批通过的方案',
    );
    await user.click(within(details).getByRole('button', { name: '确认发布执行计划' }));
    await screen.findByText('排产员已发布计划 V2，流程已完成。');
    expect(screen.queryByRole('button', { name: '确认发布执行计划' })).toBeNull();
    expect(calls.find((call) => call.path === '/api/decisions')?.body).toMatchObject({
      candidate_id: 'transfer',
      action: 'publish',
    });
    expect(calls.some((call) => call.path === '/api/workflow')).toBe(false);
    await user.click(screen.getByRole('button', { name: '← 工作台总览' }));
    await screen.findByLabelText('计划发布：已发布 V2');
    await user.click(screen.getByRole('button', { name: '审批详情' }));
    await screen.findByText('排产员已发布计划 V2，流程已完成。');
  });

  it('keeps six chapters and links the evidence outline to flat cards, tabs and single disclosures', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('方案待生成');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(6);
    expect(screen.getByRole('heading', { name: '1　方案结论' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '3　候选排产计划' })).toBeTruthy();
    expect(screen.getAllByRole('img', { name: '设备工序甘特图' })).toHaveLength(1);
    expect(screen.queryByLabelText('确认理由（必填）')).toBeNull();
    const outline = screen.getByRole('navigation', { name: '本页大纲' });
    expect(
      within(outline)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      '1 方案结论',
      '2 方案对比',
      '3 候选排产计划',
      '4 依据与风险',
      ...evidenceEntries.map(([, title]) => title),
      '5 人工确认',
      '6 历史记录',
    ]);
    expect(
      screen.getByRole('heading', { name: '4.10 查看本次 Agent 链路' }).closest('details')?.open,
    ).toBe(false);
    expect(calls.some((call) => call.path === '/api/workflow')).toBe(false);
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
    await screen.findByText('管理者已批准，待排产员发布');
    const status = screen.getByText('管理者已批准，待排产员发布');
    const pageHeader = status.closest<HTMLElement>('.decision-page-header')!;
    expect(pageHeader.querySelector('.workbench-logo')).toBeTruthy();
    expect(within(pageHeader).getByRole('navigation', { name: '当前位置' })).toBeTruthy();
    expect(
      within(pageHeader).getByText('管理者已批准，请核对方案后发布；修改方案后需要重新审批。'),
    ).toBeTruthy();
    const headerActions = pageHeader.querySelector('.fault-header-actions')!;
    expect(
      within(headerActions as HTMLElement).getByRole('button', { name: /工作台总览/ }),
    ).toBeTruthy();
    expect(
      within(headerActions as HTMLElement).getByRole('button', { name: '原 AI 方案' }),
    ).toBeTruthy();
    expect(
      status.closest('.planner-title-row')?.querySelector('h1 > span:last-child')?.textContent,
    ).toBe('故障影响与方案决策');
    expect(document.querySelector('.fault-system-tools')).toBeNull();
    expect(screen.queryByRole('button', { name: '切换角色' })).toBeNull();
    const conclusion = document.getElementById('fault-conclusion')!;
    expect(conclusion.querySelector('h3')?.textContent).toContain('预计整体提前 240 分钟完工');
    expect(within(conclusion).getByLabelText('方案分析标识')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(6);
    expect(screen.getAllByRole('img', { name: '设备工序甘特图' })).toHaveLength(2);
    expect(screen.getByRole('heading', { name: '1　方案结论' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '3　候选排产计划' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '4　依据与风险' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '5　人工确认' })).toBeTruthy();
    expect(screen.getByLabelText('确认理由（必填）')).toBeTruthy();
    expect(screen.getByRole('region', { name: '辅助分析' }).closest('details')).toBeNull();
    expect(screen.queryByText('展开工序变化、影响链与计算依据')).toBeNull();
    for (const title of ['4.4 工序调整对照', '4.5 订单交付对照']) {
      await user.click(screen.getByRole('tab', { name: title }));
      expect(screen.getByRole('heading', { name: title }).closest('details')).toBeNull();
    }
    expect(document.querySelectorAll('.decision-system-panel')).toHaveLength(4);
    expect(document.querySelectorAll('.decision-system-panel[open]')).toHaveLength(0);
    expect(document.querySelector('#fault-evidence details details')).toBeNull();
    expect(document.querySelector('#fault-comparison-details details details')).toBeNull();
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    const links = within(outline).getAllByRole('link');
    expect(links).toHaveLength(17);
    for (const link of links) {
      expect(document.getElementById(link.getAttribute('href')!.slice(1))).toBeTruthy();
    }
    const route = location.href;
    await user.click(within(outline).getByRole('link', { name: '4.7 方案计算依据' }));
    await waitFor(() => expect(document.activeElement?.id).toBe('section-evidence'));
    expect(
      screen.getByRole('tab', { name: '4.7 方案计算依据' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(screen.queryByRole('heading', { name: '4.5 订单交付对照' })).toBeNull();
    const evidenceTab = screen.getByRole('tab', { name: '4.7 方案计算依据' });
    evidenceTab.focus();
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '4.4 工序调整对照' }));
    await user.keyboard('{ArrowRight}');
    expect(
      screen.getByRole('tab', { name: '4.5 订单交付对照' }).getAttribute('aria-selected'),
    ).toBe('true');
    await user.click(within(outline).getByRole('link', { name: '4.11 执行详情' }));
    await waitFor(() => expect(document.activeElement?.id).toBe('section-execution-details'));
    expect((document.getElementById('fault-execution-panel') as HTMLDetailsElement).open).toBe(
      true,
    );
    expect(document.querySelectorAll('.decision-system-panel[open]')).toHaveLength(1);
    expect(document.querySelector('#fault-evidence details details')).toBeNull();
    expect(location.href).toBe(route);
    expect(calls.filter((call) => call.path === '/api/workflow')).toHaveLength(1);
    expect(calls.some((call) => call.path === '/api/decisions')).toBe(false);
  });

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
    await screen.findByRole('heading', { name: '当前执行计划' });
    await user.click(screen.getByText('兜底演示', { selector: 'summary' }));
    const checkbox = screen.getByRole('checkbox', {
      name: /下一次生成模拟排产/,
    }) as HTMLInputElement;
    await user.click(checkbox);
    await waitFor(() => expect(checkbox.checked).toBe(true));
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
    await screen.findByText('排产执行：兜底演示（模拟）');
    const cooldown = screen.getByRole('checkbox', {
      name: /下一次生成模拟排产/,
    }) as HTMLInputElement;
    await waitFor(() => expect(cooldown.checked).toBe(false));
    expect(cooldown.disabled).toBe(true);
    expect(calls.some((call) => call.body?.demo_fallback === true)).toBe(true);
    const generate = screen.getByRole('button', {
      name: /生成候选方案|开始 AI 分析并生成方案/,
    }) as HTMLButtonElement;
    expect(generate.disabled).toBe(false);
    await user.click(generate);
    await screen.findByRole('heading', { name: '2　方案对比' });
    expect(
      calls.filter((call) => call.path === '/api/workflow').at(-1)?.body?.demo_fallback,
    ).not.toBe(true);
  });

  it('cancels a pending generation without accepting late results and allows regeneration', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前执行计划' });
    let finish!: (response: Response) => void;
    let signal: AbortSignal | null | undefined;
    vi.mocked(fetch).mockImplementationOnce((_url, options) => {
      signal = options?.signal;
      // Simulate a response that arrives after cancellation despite the abort.
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
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
    expect(document.getElementById('fault-compare-summary')?.textContent).toMatch(
      /生成候选后|无可执行候选/,
    );
    expect(screen.queryByRole('button', { name: /^采纳/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
    await screen.findByRole('heading', { name: '2　方案对比' });
    expect(screen.getByText('工作流：已完成')).toBeTruthy();
  });

  it('updates only the active Agent from real streamed events and opens its completed details', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前执行计划' });
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
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
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
    await waitFor(() => expect(document.activeElement?.tagName).toBe('ARTICLE'));
    expect(document.activeElement?.closest('details')?.open).toBe(true);
    expect(screen.getByRole('heading', { name: '输出质量检查' })).toBeTruthy();
    expect(screen.getByText(/第 1 轮：检查覆盖遗漏/)).toBeTruthy();
    expect(screen.getByText(/第 2 轮：按原始快照重建校验覆盖；检查通过/)).toBeTruthy();
    await send({ type: 'result', data: workflowFixture });
    await act(async () => controller.close());
    await screen.findByRole('heading', { name: '2　方案对比' });
    expect(
      screen.getByLabelText('智能环节执行顺序').querySelectorAll('[data-status="running"]'),
    ).toHaveLength(0);
    expect(screen.getByText('工作流：已完成')).toBeTruthy();
  });

  it.each(['live', 'fallback'] as const)(
    'displays model mode %s and retains the authoritative explanation',
    async (mode) => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole('heading', { name: '当前执行计划' });
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
      await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
      await screen.findByText('工作流：已完成');
      expect(
        within(screen.getByLabelText('智能环节执行顺序')).getAllByText(
          mode === 'live' ? '模型辅助' : '规则回退',
        ),
      ).toHaveLength(4);
      expect(
        within(document.getElementById('fault-evidence')!).getByText('已比较两个候选方案。'),
      ).toBeTruthy();
      expect(screen.getByText('转移方案改变设备。')).toBeTruthy();
      if (mode === 'live') {
        expect(screen.getByRole('heading', { name: '本次 AI 分析重点' })).toBeTruthy();
        expect(
          within(screen.getByLabelText('辅助分析')).getByText('计划员核实恢复时间。'),
        ).toBeTruthy();
      } else {
        expect(screen.getByLabelText('模型辅助执行情况')).toBeTruthy();
        expect(screen.getByText(/模型辅助已完成 0\/4/)).toBeTruthy();
        expect(screen.queryByRole('heading', { name: '本次 AI 分析重点' })).toBeNull();
      }
      expect(screen.getAllByText(/输入\/输出 Token：未提供\/未提供/)).toHaveLength(4);
    },
  );

  it('groups evidence per candidate and keeps raw data in sibling debug details', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前执行计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
    await screen.findByRole('tab', { name: '4.7 方案计算依据' });
    await user.click(screen.getByRole('tab', { name: '4.7 方案计算依据' }));
    expect(screen.queryAllByText(/^查看依据/)).toHaveLength(0);
    expect(screen.getAllByText('查看计算依据')).toHaveLength(2);
    const candidateEvidence = screen
      .getByRole('heading', { name: 'AI 允许转移方案', level: 4 })
      .closest('article')!;
    const basis = within(candidateEvidence).getByText('查看计算依据').parentElement!;
    expect(basis.tagName).toBe('DIV');
    expect(within(basis).getByText('计算口径')).toBeTruthy();
    const debug = within(candidateEvidence).getByText('调试详情').closest('.workflow-evidence')!;
    expect(debug.parentElement).toBe(basis.parentElement);
    expect(basis.contains(debug)).toBe(false);
    expect(debug.tagName).toBe('DIV');
    expect(debug.querySelector('pre')?.textContent).toContain('metrics-1');
    expect(debug.querySelector('pre')?.textContent).toContain('"extra_changeovers": null');
    const explanation = screen.getByRole('region', { name: '辅助分析' });
    expect(within(explanation).getByText('转移方案改变设备。')).toBeTruthy();
    expect(within(explanation).getByText('因此将该工序转到M2，可提前15分钟开工。').tagName).toBe(
      'STRONG',
    );
    expect(within(explanation).getByText('已比较两个候选方案。').tagName).toBe('STRONG');
    expect(screen.getByRole('heading', { name: /建议优先采用【AI 允许转移方案】/ }).tagName).toBe(
      'H3',
    );
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
    await screen.findByRole('heading', { name: '当前执行计划' });
    expect(
      (
        screen.getByRole('button', {
          name: /生成候选方案|开始 AI 分析并生成方案/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('heading', { name: '4.11 执行详情' }).closest('summary')!);
    await user.click(screen.getByRole('button', { name: '仅校验数据' }));
    await screen.findByText('工作流：已阻断');
    expect(calls.find((call) => call.path === '/api/workflow')?.body?.intent).toBe('validate');
    expect(screen.getAllByText('请补充预计恢复时间。').length).toBeGreaterThan(0);
    expect(document.getElementById('fault-compare-summary')?.textContent).toMatch(
      /生成候选后|无可执行候选/,
    );
    expect(screen.queryByRole('button', { name: /^采纳/ })).toBeNull();
    expect(screen.getByLabelText('智能环节执行顺序').children).toHaveLength(1);
  });

  it('answers separately without replacing the workflow or losing comparison', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前执行计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
    await screen.findByRole('heading', { name: '4.9 解释问题' });
    await user.click(screen.getByRole('heading', { name: '4.9 解释问题' }).closest('summary')!);
    await user.clear(screen.getByLabelText('解释问题'));
    await user.type(screen.getByLabelText('解释问题'), '解释设备转移风险');
    await user.click(screen.getByRole('button', { name: '✨ 获取 AI 解答' }));
    await screen.findByRole('region', { name: 'AI 解答' });
    expect(calls.filter((c) => c.path === '/api/workflow')).toHaveLength(1);
    expect(calls.find((c) => c.path === '/api/copilot/ask')?.body).toMatchObject({
      workflow_id: 'workflow-1',
      question: '解释设备转移风险',
    });
    expect(screen.getByRole('heading', { name: '2　方案对比' })).toBeTruthy();
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
    await screen.findByRole('heading', { name: '当前执行计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
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

  it('keeps results and inputs on tab focus and opening the fault editor', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByRole('heading', { name: '当前执行计划' });
    expect(calls.filter((call) => call.path === '/api/workbench')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
    await screen.findByRole('heading', { name: '2　方案对比' });
    await user.type(screen.getByLabelText('解释问题'), '关注延期');
    const question = (screen.getByLabelText('解释问题') as HTMLTextAreaElement).value;
    fireEvent(window, new Event('blur'));
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('pageshow'));
    fireEvent(window, new Event('focus'));
    expect(screen.getByRole('heading', { name: '2　方案对比' })).toBeTruthy();
    expect((screen.getByLabelText('解释问题') as HTMLTextAreaElement).value).toBe(question);
    expect(calls.filter((call) => call.path === '/api/workbench')).toHaveLength(2);
    expect(calls.filter((call) => call.path === '/api/workflow')).toHaveLength(1);
    await openFaultEditor();
    expect(screen.queryByRole('button', { name: '重新载入已保存事件' })).toBeNull();
    expect(screen.queryByRole('button', { name: '恢复上次可试算事件' })).toBeNull();
    expect(screen.getByRole('button', { name: '保存故障事件' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(calls.filter((call) => call.path === '/api/workbench')).toHaveLength(2);
  });

  it('identifies the exact model fallback and completed Agents without implying total failure', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前执行计划' });
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
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
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
    await screen.findByRole('heading', { name: '当前执行计划' });
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
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
    await screen.findByText('工作流：失败');
    const stages = screen.getByLabelText('智能环节执行顺序');
    expect(within(stages).getByText('失败')).toBeTruthy();
    expect(within(stages).getAllByText('未执行（前序阻断或失败）')).toHaveLength(3);
    expect(document.getElementById('fault-compare-summary')?.textContent).toMatch(
      /生成候选后|无可执行候选/,
    );
    expect(screen.queryByRole('button', { name: /^采纳/ })).toBeNull();
  });

  it('runs four Agents, displays warnings and routes generated candidates to human publication', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前执行计划' });
    expect(
      screen.getAllByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }),
    ).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: '四 Agent 动态编排' })).toBeNull();
    expect(screen.queryByRole('button', { name: '生成并评估方案' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
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
    expect(
      within(document.getElementById('fault-evidence')!).getByText('已比较两个候选方案。'),
    ).toBeTruthy();
    await screen.findByRole('heading', { name: '2　方案对比' });
    expect(calls.find((c) => c.path === '/api/workflow')?.body?.intent).toBe('generate_candidates');
    expect(calls.some((c) => c.path === '/api/decisions')).toBe(false);
    expect(calls.some((c) => ['/api/simulations', '/api/analysis'].includes(c.path))).toBe(false);
    expect(screen.queryByText('启用 API 多 Agent')).toBeNull();
    expect(screen.getByRole('heading', { name: '4.1 事实/假设与风险' })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('本次处理的方案'), 'transfer');
    await user.selectOptions(screen.getByLabelText('处理方式'), 'publish');
    await user.type(screen.getByLabelText('确认理由（必填）'), '确认发布');
    await user.click(screen.getByRole('button', { name: '确认发布执行计划' }));
    await screen.findByText('已发布方案，执行计划版本 V2。');
    expect(screen.getByLabelText('已发布故障方案存档')).toBeTruthy();
    expect(screen.getByText('工作流：已完成')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^采纳/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '确认发布执行计划' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '← 工作台总览' }));
    await screen.findByLabelText('计划发布：已发布 V2');
    expect(
      screen.getByText(/已发布原 AI 方案；调整 1 道工序，.*预计 0 个订单延期，共 0 分钟。/),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重新生成方案' })).toBeNull();
    expect(screen.queryByRole('button', { name: '分析影响并生成候选方案' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '查看 AI 分析详情' }));
    expect(screen.getByText('工作流：已完成')).toBeTruthy();
    expect(screen.getByLabelText('智能环节执行顺序').children).toHaveLength(4);
    expect(screen.queryByRole('button', { name: '查看方案对比与发布' })).toBeNull();
  });

  it('reuses the workflow identifier for evaluation and clears it on unsaved edits', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前执行计划' });
    await user.click(screen.getByRole('heading', { name: '4.11 执行详情' }).closest('summary')!);
    expect(
      (screen.getByRole('button', { name: '重新评估已有方案' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
    await screen.findByText('工作流：已完成');
    await user.click(screen.getByRole('button', { name: '重新评估已有方案' }));
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/workflow')).toHaveLength(2));
    expect(calls.filter((c) => c.path === '/api/workflow')[1].body).toMatchObject({
      intent: 're_evaluate',
      workflow_id: 'workflow-1',
    });
    await screen.findAllByText('暂无完整解释，已有检查结果可在执行详情中查看。');
    expect(screen.queryByText('已比较两个候选方案。')).toBeNull();
    expect(screen.getByRole('heading', { name: '2　方案对比' })).toBeTruthy();
    await openFaultEditor();
    expect((screen.getByLabelText('预计恢复日期') as HTMLInputElement).type).toBe('date');
    expect(
      (
        within(screen.getByRole('group', { name: '预计恢复时间' })).getByLabelText(
          '预计恢复时间',
        ) as HTMLInputElement
      ).type,
    ).toBe('time');
    expect(document.querySelector('.event-editor input[type="datetime-local"]')).toBeNull();
    fireEvent.change(
      within(screen.getByRole('group', { name: '预计恢复时间' })).getByLabelText('预计恢复时间'),
      { target: { value: '18:00' } },
    );
    expect(screen.queryByText('工作流：已完成')).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: /生成候选方案|开始 AI 分析并生成方案/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('submits a no-candidate assessment and opens its alert details without regenerating', async () => {
    const assessment = {
      outcome: 'no_feasible_candidate' as const,
      summary: '分析已完成：当前策略未生成可用方案',
      findings: [{ text: 'M2 工序预计 00:45 完工，超过班次 00:00', evidence_refs: [] }],
      recommendations: ['补录实际班次'],
      limitations: ['审批通过不发布排产变更'],
    };
    const result: WorkflowResponse = {
      simulation: null,
      workflow: {
        ...workflowFixture.workflow,
        id: 'assessment-1',
        results: {
          evaluation: {
            status: 'warning',
            warnings: [],
            errors: [],
            data: { evaluations: [], assessment },
          },
          explanation: {
            status: 'warning',
            warnings: [],
            errors: [],
            data: { summary: assessment.summary, facts: assessment.findings },
          },
        },
      },
    };
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      if (args[0] === '/api/workflow') return new Response(JSON.stringify(result));
      if (args[0] === '/api/workflow/assessment-1/review')
        return new Response(
          JSON.stringify({
            ...workbench,
            fault_review: {
              id: 'assessment-review',
              kind: 'assessment',
              workflow_id: 'assessment-1',
              simulation_id: '',
              candidate_id: '',
              event_revision: workbench.event_revision,
              baseline_fingerprint: workbench.baseline.fingerprint,
              status: 'pending',
              reason: '核对结论',
              review_reason: '',
              metrics: null,
              assessment,
            },
          }),
        );
      return baseFetch(...args);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前执行计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
    const conclusion = await screen.findByLabelText('评估结论与审批');
    expect(conclusion.textContent).toContain('00:45');
    expect(document.getElementById('fault-compare-summary')?.textContent).toMatch(
      /生成候选后|无可执行候选/,
    );
    expect(screen.queryByRole('button', { name: /^采纳/ })).toBeNull();
    const confirmation = document.getElementById('fault-human-decision')!;
    await user.type(within(confirmation).getByLabelText('提交理由（必填）'), '核对结论');
    await user.click(within(confirmation).getByRole('button', { name: '提交管理者审批' }));
    await screen.findByText('评估结论已提交管理者审批；审批通过后不产生排产变更。');
    await user.click(screen.getByRole('button', { name: '← 工作台总览' }));
    const alerts = screen.getByRole('heading', { name: '异常与预警' }).closest('section')!;
    expect(within(alerts).getByLabelText('AI 分析方案：已完成')).toBeTruthy();
    expect(within(alerts).getByLabelText('管理者审批：待审批')).toBeTruthy();
    await user.click(
      await within(alerts).findByRole('button', { name: '查看AI评估详情' }, { timeout: 5000 }),
    );
    await screen.findByRole('heading', { name: '故障影响与方案决策', level: 1 });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('评估结论与审批').textContent).toContain('00:45');
    expect(location.hash).toBe('#/planner/fault-decision');
    act(() => history.back());
    await screen.findByRole('heading', { name: '排产计划工作台' });
    expect(location.hash).toBe('#/planner');
    act(() => history.forward());
    await screen.findByRole('heading', { name: '故障影响与方案决策', level: 1 });
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: '← 工作台总览' }));
    await screen.findByRole('heading', { name: '排产计划工作台' });
    expect(location.hash).toBe('#/planner');
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/workflow')).toHaveLength(1);
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
    await screen.findByRole('heading', { name: '当前执行计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
    await screen.findByText('工作流：已阻断');
    expect(screen.getByText('预计恢复时间未知，请人工补充。')).toBeTruthy();
    expect(document.getElementById('fault-compare-summary')?.textContent).toMatch(
      /生成候选后|无可执行候选/,
    );
    expect(screen.queryByRole('button', { name: /^采纳/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '查看AI评估详情' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }),
    ).toBeNull();

    const generationRequests = () =>
      vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/workflow').length;
    expect(generationRequests()).toBe(1);
    await user.click(screen.getByRole('button', { name: '← 工作台总览' }));
    const alerts = screen.getByRole('heading', { name: '异常与预警' }).closest('section')!;
    const alertButton = within(alerts).getByRole('button', { name: '查看AI评估详情' });
    expect(alertButton.querySelector('.ai-bot-icon')).toBeTruthy();
    await user.click(alertButton);
    await screen.findByRole('heading', { name: '故障影响与方案决策', level: 1 });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('预计恢复时间未知，请人工补充。')).toBeTruthy();
    expect(generationRequests()).toBe(1);
    await user.click(screen.getByRole('button', { name: '重新生成评估' }));
    await waitFor(() => expect(generationRequests()).toBe(2));
  });

  it('shows the rescheduled waiting candidate as reference and publishes a server-owned candidate', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前执行计划' });
    const formalPlanBefore = screen.getByRole('img', { name: '设备工序甘特图' }).outerHTML;
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
    await screen.findByRole('heading', { name: '2　方案对比' });
    expect(screen.getAllByRole('img', { name: '设备工序甘特图' })).toHaveLength(2);
    const reference = within(screen.getByLabelText('AI 原线等待方案排产图')).getByRole('img');
    expect(reference.outerHTML).not.toBe(formalPlanBefore);
    expect(
      within(reference).getByRole('graphics-symbol', { name: /17:00.*18:00.*时间调整/ }),
    ).toBeTruthy();
    expect(screen.queryByRole('graphics-symbol', { name: /^原安排/ })).toBeNull();
    expect(
      within(screen.getByLabelText('本次处理的方案')).getByText('AI 原线等待方案'),
    ).toBeTruthy();
    expect(
      document.querySelectorAll(
        'rect[stroke="#EF4444"], rect[stroke="#B45309"], rect[stroke="#7C3AED"]',
      ).length,
    ).toBe(0);
    expect(document.querySelectorAll('.evidence-cell')).toHaveLength(2);
    await user.selectOptions(screen.getByLabelText('本次处理的方案'), 'transfer');
    await user.selectOptions(screen.getByLabelText('处理方式'), 'publish');
    await user.type(screen.getByLabelText('确认理由（必填）'), '接受设备转移');
    await user.click(screen.getByRole('button', { name: '确认发布执行计划' }));
    await screen.findByText('已发布方案，执行计划版本 V2。');
    const decision = calls.find((call) => call.path === '/api/decisions')!.body!;
    expect(decision.candidate_id).toBe('transfer');
    expect(decision.simulation_id).toBe('batch-1');
    expect(decision).not.toHaveProperty('schedule');
    expect(document.getElementById('fault-compare-summary')?.textContent).toContain(
      '分析时的执行计划',
    );
    expect(screen.getByLabelText('原 AI 方案')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^采纳/ })).toBeNull();
  });

  it('invalidates visible candidates immediately on unsaved event edits', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前执行计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
    await screen.findByRole('heading', { name: '2　方案对比' });
    await openFaultEditor();
    fireEvent.change(
      within(screen.getByRole('group', { name: '预计恢复时间' })).getByLabelText('预计恢复时间'),
      { target: { value: '18:00' } },
    );
    expect(screen.queryByRole('heading', { name: '2　方案对比' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^采纳/ })).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: /生成候选方案|开始 AI 分析并生成方案/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: '保存故障事件' }));
    await waitFor(() => expect(calls.some((call) => call.path === '/api/event')).toBe(true));
    const saved = calls.find((call) => call.path === '/api/event')!.body!;
    expect(saved.event_revision).toBe(1);
    expect(saved.recovered_at).toBe('2026-10-19T18:00:00+08:00');
  });

  it('surfaces stale versions and blocks saving and analysis until page refresh', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '当前执行计划' });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: '事件或计划已更新，请重新载入后操作' }), {
        status: 409,
      }),
    );
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
    await screen.findByText('后台事件或计划已更新，请刷新页面获取最新记录后继续。');
    expect(
      (
        screen.getByRole('button', {
          name: /生成候选方案|开始 AI 分析并生成方案/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await openFaultEditor();
    expect(
      (screen.getByRole('button', { name: '保存故障事件' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('always formats editor times in the workshop timezone', () => {
    expect(localInput('2026-10-19T05:00:00Z')).toBe('2026-10-19T13:00');
  });

  it('saves unknown recovery and allows manually editing the recovery time', async () => {
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
    await screen.findByRole('heading', { name: '当前执行计划' });
    await openFaultEditor();
    await user.click(screen.getByLabelText('预计恢复时间未知'));
    expect(screen.queryByRole('group', { name: '预计恢复时间' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '保存故障事件' }));
    await screen.findByText('故障事件已保存。请重新生成候选方案，执行计划未改变。');
    expect(
      (
        screen.getByRole('button', {
          name: /生成候选方案|开始 AI 分析并生成方案/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(calls.find((call) => call.path === '/api/event')!.body!.recovered_at).toBeNull();
    await openFaultEditor();
    await user.click(screen.getByLabelText('预计恢复时间未知'));
    expect(screen.getByRole('group', { name: '预计恢复时间' })).toBeTruthy();
    expect(calls.some((call) => call.path === '/api/event/recover')).toBe(false);
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
    await screen.findByRole('heading', { name: '当前执行计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
    await screen.findByRole('heading', { name: '2　方案对比' });
    await user.type(screen.getByLabelText('确认理由（必填）'), '等待维修确认');
    expect(
      (screen.getByRole('button', { name: '修改后重新提交审批' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: '记录暂不发布' }));
    await screen.findByText('已记录暂不发布，执行计划保持不变。');
    expect(screen.getByRole('heading', { name: '2　方案对比' })).toBeTruthy();
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
    await screen.findByRole('heading', { name: '当前执行计划' });
    await user.click(screen.getByRole('button', { name: /生成候选方案|开始 AI 分析并生成方案/ }));
    await screen.findByRole('heading', { name: '2　方案对比' });
    await user.selectOptions(screen.getByLabelText('本次处理的方案'), 'transfer');
    await user.selectOptions(screen.getByLabelText('处理方式'), 'publish');
    await user.type(screen.getByLabelText('确认理由（必填）'), '确认转移');
    expect(screen.getByRole('option', { name: '正式发布' })).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: '记录暂不发布' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: '确认发布执行计划' }));
    await screen.findByText('无法连接后端。请确认 FastAPI 已在 8000 端口启动。');
    await user.click(screen.getByRole('button', { name: '确认发布执行计划' }));
    await screen.findByText('已发布方案，执行计划版本 V2。');
    const decisions = calls.filter((call) => call.path === '/api/decisions');
    expect(decisions).toHaveLength(2);
    expect(decisions[0].body!.request_id).toBe(decisions[1].body!.request_id);
  });
});

it('requires confirmation before permanently deleting a fault', async () => {
  const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false);
  try {
    render(<App />);
    await screen.findByRole('heading', { name: '故障影响与方案决策', level: 1 });
    fireEvent.click(screen.getByRole('button', { name: '← 工作台总览' }));
    await screen.findByRole('heading', { name: '排产计划工作台' });
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(confirmation).toHaveBeenCalledWith(expect.stringContaining('永久删除'));
    expect(calls.some((call) => call.path === '/api/event/cancel')).toBe(false);
    confirmation.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(calls.some((call) => call.path === '/api/event/cancel')).toBe(true));
    expect(calls.find((call) => call.path === '/api/event/cancel')?.body).toEqual({
      event_revision: workbench.event_revision,
      baseline_fingerprint: workbench.baseline.fingerprint,
    });
  } finally {
    confirmation.mockRestore();
  }
});
