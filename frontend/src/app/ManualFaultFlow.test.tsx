import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { useWorkbench } from '../features/workbench';
import { workbenchApi } from '../features/workbench/api';
import type { FaultAnalysis, ManualFaultDraft, WorkflowResponse } from '../shared/api/contracts';
import { simulation, workbench } from '../test/fixtures';
import { FaultPlanPage } from './FaultPlanPage';

vi.mock('../features/workbench/api', () => ({
  workbenchApi: {
    load: vi.fn(),
    latestWorkflow: vi.fn(),
    manualDraft: vi.fn(),
    createManualDraft: vi.fn(),
    saveManualDraft: vi.fn(),
    evaluateManualDraft: vi.fn(),
    submitFaultReview: vi.fn(),
  },
}));

const ai: WorkflowResponse = {
  simulation,
  workflow: {
    id: 'ai-analysis',
    intent: 'generate_candidates',
    status: 'completed',
    failure_code: null,
    trace: [],
    results: {},
    evidence_catalog: {},
    contribution_report: {
      title: 'AI 原始分析',
      rules_work: '规则计算',
      model_work: '规则模式',
      manual_summary: '原 AI 分析保留',
      decision: '尚未发布',
    },
  },
};
const draft: ManualFaultDraft = {
  id: 'manual-draft',
  revision: 1,
  status: 'editing',
  workflow_id: ai.workflow.id,
  source_simulation_id: simulation.id,
  source_candidate_id: simulation.candidates[0].id,
  event_revision: workbench.event_revision,
  baseline_fingerprint: workbench.baseline.fingerprint,
  schedule: simulation.candidates[0].schedule,
  origin: simulation.candidates[0].schedule,
  edits: [],
  issues: [],
  report: null,
  simulation: null,
};
const ready: ManualFaultDraft = {
  ...draft,
  status: 'ready_for_review',
  workflow: {
    ...ai.workflow,
    id: 'manual-analysis',
    contribution_report: {
      ...ai.workflow.contribution_report!,
      manual_summary: '人工分析独立保存',
    },
  },
  simulation: {
    ...simulation,
    id: 'manual-simulation',
    candidates: [
      { ...simulation.candidates[0], id: 'manual:manual-draft:2', label: '人工调整方案' },
    ],
  },
};

function Page({ onHome = () => {}, onRole }: { onHome?: () => void; onRole?: () => void }) {
  const controller = useWorkbench();
  if (!controller.state) return null;
  return (
    <FaultPlanPage
      controller={controller}
      state={controller.state}
      range={[Date.parse('2026-10-19T13:00:00+08:00'), Date.parse('2026-10-19T18:00:00+08:00')]}
      currentPlan={<p>正式计划</p>}
      onBack={onHome}
      onSwitchRole={onRole}
      onAdjust={() => {}}
    />
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(workbenchApi.load).mockResolvedValue(workbench);
  vi.mocked(workbenchApi.latestWorkflow).mockResolvedValue(ai);
  vi.mocked(workbenchApi.manualDraft).mockResolvedValue(null);
  vi.mocked(workbenchApi.createManualDraft).mockResolvedValue(draft);
  vi.mocked(workbenchApi.saveManualDraft).mockResolvedValue({ ...draft, revision: 2 });
});

it('restores both archived variants after publication and keeps their reports and approval badges separate', async () => {
  const original: FaultAnalysis = {
    event_revision: workbench.event_revision,
    baseline_version: workbench.baseline.version,
    baseline: workbench.baseline,
    affected: workbench.affected,
    workflow: ai.workflow,
    simulation,
  };
  const manual: FaultAnalysis = {
    ...original,
    workflow: ready.workflow!,
    simulation: ready.simulation!,
    decisions: {
      status: 'published',
      candidate_id: ready.simulation!.candidates[0].id,
      reason: '人工核对',
      review_reason: '同意发布',
      reviewed_at: workbench.snapshot_time,
    },
  };
  vi.mocked(workbenchApi.load).mockResolvedValue({
    ...workbench,
    baseline: ready.simulation!.candidates[0].schedule,
    affected: [],
    plan_publication: {
      version: 2,
      published_at: workbench.snapshot_time,
      published_by: 'planner_01',
      version_summary: '人工方案已发布',
      current_fault_analysis: {
        ...manual,
        variants: { ai: original, manual },
        selected_variant: 'manual',
        selected_candidate_id: ready.simulation!.candidates[0].id,
        published_version: 2,
      },
    },
  });
  vi.mocked(workbenchApi.latestWorkflow).mockResolvedValue(null);
  const user = userEvent.setup();
  render(<Page />);
  await screen.findByText('人工分析独立保存');
  const switches = within(screen.getByRole('group', { name: '分析方案切换' }));
  expect(switches.getByRole('button', { name: '人工调整方案' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(switches.getByRole('button', { name: '人工调整方案' }).textContent).toContain('已发布');
  expect(switches.getByRole('button', { name: '原 AI 方案' }).textContent).toContain('未提交审批');
  expect(screen.queryByRole('button', { name: /采纳|返回调整|发布|手动调整/ })).toBeNull();
  await user.click(switches.getByRole('button', { name: '原 AI 方案' }));
  expect(screen.getByText('原 AI 分析保留')).toBeTruthy();
  expect(screen.queryByText('人工分析独立保存')).toBeNull();
  expect(screen.getByText(/实际发布：人工调整方案，执行计划 V2/)).toBeTruthy();
  expect(screen.getByText('受影响 1 道工序')).toBeTruthy();
  await user.click(switches.getByRole('button', { name: '人工调整方案' }));
  expect(screen.getByText('人工分析独立保存')).toBeTruthy();
  expect(workbenchApi.createManualDraft).not.toHaveBeenCalled();
  expect(workbenchApi.saveManualDraft).not.toHaveBeenCalled();
  expect(workbenchApi.submitFaultReview).not.toHaveBeenCalled();
});

it.each(['选择角色', '工作台总览', '故障影响与方案决策', '选择编辑起点'])(
  'navigates from manual editing through the %s breadcrumb without saving changes',
  async (target) => {
    const user = userEvent.setup();
    const onHome = vi.fn();
    const onRole = vi.fn();
    render(<Page onHome={onHome} onRole={onRole} />);
    await user.click(await screen.findByRole('button', { name: '不采纳，手动调整' }));
    expect(screen.queryByText('待选择编辑起点')).toBeNull();
    await user.click(screen.getByRole('radio', { name: /AI 原线等待方案/ }));
    await user.click(screen.getByRole('button', { name: '基于所选方案编辑' }));
    const editor = within(screen.getByRole('dialog'));
    expect(editor.queryByText('人工调整中')).toBeNull();
    expect(
      editor.getByText('人工调整排产方案', { selector: '[aria-current="page"]' }),
    ).toBeTruthy();
    fireEvent.keyDown(editor.getByRole('graphics-symbol'), { key: 'ArrowRight' });
    const path = within(editor.getByRole('navigation', { name: '当前位置' }));
    await user.click(path.getByRole('button', { name: target }));
    if (target === '选择编辑起点') {
      const picker = within(screen.getByRole('dialog', { name: '选择编辑起点' }));
      expect(
        (picker.getByRole('radio', { name: /AI 原线等待方案/ }) as HTMLInputElement).checked,
      ).toBe(true);
      await user.click(
        within(picker.getByRole('navigation')).getByRole('button', { name: '故障影响与方案决策' }),
      );
    }
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onHome).toHaveBeenCalledTimes(target === '工作台总览' ? 1 : 0);
    expect(onRole).toHaveBeenCalledTimes(target === '选择角色' ? 1 : 0);
    expect(workbenchApi.createManualDraft).not.toHaveBeenCalled();
    expect(workbenchApi.saveManualDraft).not.toHaveBeenCalled();
    expect(workbenchApi.evaluateManualDraft).not.toHaveBeenCalled();
  },
);

it('keeps edits local and cancels without requests', async () => {
  const user = userEvent.setup();
  render(<Page />);
  await user.click(await screen.findByRole('button', { name: '不采纳，手动调整' }));
  await user.click(screen.getByRole('radio', { name: /AI 原线等待方案/ }));
  await user.click(screen.getByRole('button', { name: '基于所选方案编辑' }));
  const dialog = screen.getByRole('dialog', { name: '人工调整排产方案' });
  expect(within(dialog).getByRole('button', { name: 'AI 评估方案' })).toBeTruthy();
  const bar = within(dialog).getByRole('graphics-symbol');
  fireEvent.keyDown(bar, { key: 'ArrowRight' });
  expect(bar.getAttribute('aria-label')).toContain('17:05');
  expect(workbenchApi.saveManualDraft).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: '取消' }));
  const picker = within(screen.getByRole('dialog', { name: '选择编辑起点' }));
  expect((picker.getByRole('radio', { name: /AI 原线等待方案/ }) as HTMLInputElement).checked).toBe(
    true,
  );
  await user.click(picker.getByRole('button', { name: '基于所选方案编辑' }));
  expect(
    within(screen.getByRole('dialog')).getByRole('graphics-symbol').getAttribute('aria-label'),
  ).toContain('17:00');
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: '← 选择编辑起点' }),
  );
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(workbenchApi.createManualDraft).not.toHaveBeenCalled();
  expect(screen.getByText('原 AI 分析保留')).toBeTruthy();
});

it('shows published and current future downtime with complete source records in the editor', async () => {
  vi.mocked(workbenchApi.load).mockResolvedValue({
    ...workbench,
    plan_publication: {
      version: workbench.baseline.version,
      published_at: null,
      published_by: null,
      version_summary: '上一版发布',
      fault_traces: [
        {
          version: 1,
          event_revision: 1,
          failure: {
            ...workbench.event,
            started_at: '2026-10-19T12:00:00+08:00',
            source: '上一版维修记录',
          },
          affected_operations: [],
        },
      ],
    },
  });
  const user = userEvent.setup();
  render(<Page />);
  await user.click(await screen.findByRole('button', { name: '不采纳，手动调整' }));
  await user.click(screen.getByRole('radio', { name: /AI 原线等待方案/ }));
  await user.click(screen.getByRole('button', { name: '基于所选方案编辑' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByRole('group', { name: 'M1 已发布停机 V1' })).toBeTruthy();
  expect(dialog.getByRole('group', { name: 'M1 本次故障' })).toBeTruthy();
  expect(dialog.getByText(/执行快照时间：/)).toBeTruthy();
  await user.click(dialog.getByText('停机记录与来源'));
  expect(dialog.getByText(/来源：上一版维修记录/).textContent).toContain('12:00');
  expect(dialog.getByText(/来源：维修班组/)).toBeTruthy();
});

it.each(['当前执行计划 V4', 'AI 原线等待方案', 'AI 允许转移方案'])(
  'shows published M3 downtime and the current fault in the read-only %s preview',
  async (basis) => {
    vi.mocked(workbenchApi.load).mockResolvedValue({
      ...workbench,
      baseline: { ...workbench.baseline, version: 4 },
      machines: [...workbench.machines, { id: 'M3', name: '设备三', capabilities: ['turn'] }],
      plan_publication: {
        version: 4,
        published_at: null,
        published_by: null,
        version_summary: '执行计划 V4',
        fault_traces: [
          {
            version: 3,
            event_revision: 1,
            failure: {
              ...workbench.event,
              machine_id: 'M3',
              recovered_at: '2026-10-19T20:00:00+08:00',
              source: '上一版 M3 维修记录',
            },
            affected_operations: [],
          },
        ],
      },
    });
    const user = userEvent.setup();
    render(<Page />);
    await user.click(await screen.findByRole('button', { name: '不采纳，手动调整' }));
    await user.click(screen.getByRole('radio', { name: new RegExp(basis) }));
    const preview = within(screen.getByRole('region', { name: '编辑起点预览' }));
    expect(preview.getByRole('heading', { name: `${basis} · 只读预览` })).toBeTruthy();
    expect(preview.getByRole('group', { name: 'M3 停机留痕' })).toBeTruthy();
    expect(preview.getByRole('group', { name: 'M1 停机留痕' })).toBeTruthy();
    expect(preview.getByText('20:00')).toBeTruthy();
    const bar = preview.getByRole('graphics-symbol');
    const originalLabel = bar.getAttribute('aria-label');
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(bar.getAttribute('aria-label')).toBe(originalLabel);
    expect(workbenchApi.createManualDraft).not.toHaveBeenCalled();
    expect(workbenchApi.saveManualDraft).not.toHaveBeenCalled();
    expect(workbenchApi.evaluateManualDraft).not.toHaveBeenCalled();
  },
);

it('excludes published fault traces from a different execution version in the preview', async () => {
  vi.mocked(workbenchApi.load).mockResolvedValue({
    ...workbench,
    baseline: { ...workbench.baseline, version: 4 },
    machines: [...workbench.machines, { id: 'M3', name: '设备三', capabilities: ['turn'] }],
    plan_publication: {
      version: 3,
      published_at: null,
      published_by: null,
      version_summary: '过期发布记录',
      fault_traces: [
        {
          version: 3,
          event_revision: 1,
          failure: { ...workbench.event, machine_id: 'M3' },
          affected_operations: [],
        },
      ],
    },
  });
  const user = userEvent.setup();
  render(<Page />);
  await user.click(await screen.findByRole('button', { name: '不采纳，手动调整' }));
  await user.click(screen.getByRole('radio', { name: /当前执行计划 V4/ }));
  const preview = within(screen.getByRole('region', { name: '编辑起点预览' }));
  expect(preview.queryByRole('group', { name: 'M3 停机留痕' })).toBeNull();
  expect(preview.getByRole('group', { name: 'M1 停机留痕' })).toBeTruthy();
});

it('closes the modal immediately and preserves whole-page AI/manual views during evaluation', async () => {
  const user = userEvent.setup();
  let finish!: (value: ManualFaultDraft) => void;
  vi.mocked(workbenchApi.evaluateManualDraft).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<Page />);
  await user.click(await screen.findByRole('button', { name: '不采纳，手动调整' }));
  await user.click(screen.getByRole('radio', { name: /AI 原线等待方案/ }));
  await user.click(screen.getByRole('button', { name: '基于所选方案编辑' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'AI 评估方案' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('heading', { name: '故障影响与方案决策' })).toBeTruthy();
  await waitFor(() => expect(workbenchApi.evaluateManualDraft).toHaveBeenCalled());
  await user.click(screen.getByRole('button', { name: '原 AI 方案' }));
  expect(screen.getByText('原 AI 分析保留')).toBeTruthy();
  await act(async () => finish(ready));
  expect(screen.getByRole('button', { name: '原 AI 方案' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.queryByText('人工分析独立保存')).toBeNull();
  await user.click(screen.getByRole('button', { name: '人工调整方案' }));
  expect(screen.getByText('人工分析独立保存')).toBeTruthy();
  expect(screen.queryByText('原 AI 分析保留')).toBeNull();
  const section = screen.getByRole('heading', { name: '3　候选排产计划' }).closest('section')!;
  expect(within(section).getByRole('heading', { name: '人工调整方案' })).toBeTruthy();
  expect(within(section).getByRole('heading', { name: 'AI 原线等待方案' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '原 AI 方案' }));
  expect(screen.getByText('原 AI 分析保留')).toBeTruthy();
  expect(workbenchApi.createManualDraft).toHaveBeenCalledTimes(1);
});

it('requires an explicit basis and previews each source without saving or running analysis', async () => {
  const user = userEvent.setup();
  render(<Page />);
  await user.click(await screen.findByRole('button', { name: '不采纳，手动调整' }));
  const picker = within(screen.getByRole('dialog', { name: '选择编辑起点' }));
  expect(picker.getAllByRole('radio')).toHaveLength(3);
  expect(picker.getAllByRole('radio').every((input) => !(input as HTMLInputElement).checked)).toBe(
    true,
  );
  expect(
    (picker.getByRole('button', { name: '基于所选方案编辑' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await user.click(picker.getByRole('radio', { name: /当前执行计划/ }));
  expect(
    within(picker.getByRole('region', { name: '编辑起点预览' }))
      .getByRole('graphics-symbol')
      .getAttribute('aria-label'),
  ).toContain('13:00');
  await user.click(picker.getByRole('radio', { name: /AI 原线等待方案/ }));
  expect(
    within(picker.getByRole('region', { name: '编辑起点预览' }))
      .getByRole('graphics-symbol')
      .getAttribute('aria-label'),
  ).toContain('17:00');
  await user.click(picker.getByRole('radio', { name: /AI 允许转移方案/ }));
  expect(
    within(picker.getByRole('region', { name: '编辑起点预览' }))
      .getByRole('graphics-symbol')
      .getAttribute('aria-label'),
  ).toContain('M2');
  await user.click(picker.getByRole('button', { name: '基于所选方案编辑' }));
  const editor = within(screen.getByRole('dialog', { name: '人工调整排产方案' }));
  expect(editor.getByText('编辑起点：AI 允许转移方案')).toBeTruthy();
  expect(editor.getByText(/不会自动调整后续工序/)).toBeTruthy();
  expect(editor.getByRole('graphics-symbol').getAttribute('aria-label')).toContain('M2');
  await user.click(editor.getByRole('button', { name: '取消' }));
  expect(workbenchApi.createManualDraft).not.toHaveBeenCalled();
  expect(workbenchApi.evaluateManualDraft).not.toHaveBeenCalled();
});

it('creates a baseline draft without sending any AI candidate reference', async () => {
  const baselineDraft = {
    ...draft,
    source_candidate_id: null,
    source_simulation_id: null,
    schedule: workbench.baseline,
    origin: workbench.baseline,
  };
  vi.mocked(workbenchApi.createManualDraft).mockResolvedValue(baselineDraft);
  vi.mocked(workbenchApi.saveManualDraft).mockResolvedValue({ ...baselineDraft, revision: 2 });
  vi.mocked(workbenchApi.evaluateManualDraft).mockResolvedValue({
    ...baselineDraft,
    revision: 2,
    issues: ['需要调整故障冲突工序'],
  });
  const user = userEvent.setup();
  render(<Page />);
  await user.click(await screen.findByRole('button', { name: '不采纳，手动调整' }));
  await user.click(screen.getByRole('radio', { name: /当前执行计划/ }));
  await user.click(screen.getByRole('button', { name: '基于所选方案编辑' }));
  const editor = within(screen.getByRole('dialog'));
  expect(editor.getByText('编辑起点：当前执行计划 V1')).toBeTruthy();
  await user.click(editor.getByRole('button', { name: 'AI 评估方案' }));
  await waitFor(() =>
    expect(workbenchApi.createManualDraft).toHaveBeenCalledWith(
      ai.workflow.id,
      undefined,
      undefined,
    ),
  );
});

it('keeps the existing manual plan when a replacement basis or new editor is cancelled', async () => {
  vi.mocked(workbenchApi.manualDraft).mockResolvedValue(ready);
  const user = userEvent.setup();
  render(<Page />);
  await user.click(await screen.findByRole('button', { name: '人工调整方案' }));
  await user.click(screen.getByRole('button', { name: '继续手动调整' }));
  expect(screen.getByRole('dialog', { name: '人工调整排产方案' })).toBeTruthy();
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
  await user.click(
    within(screen.getByRole('dialog', { name: '选择编辑起点' })).getByRole('button', {
      name: '取消',
    }),
  );
  await user.click(screen.getByRole('button', { name: '重新选择编辑起点' }));
  await user.click(screen.getByRole('radio', { name: /当前执行计划/ }));
  const start = screen.getByRole('button', { name: '基于所选方案编辑' }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  await user.click(screen.getByRole('checkbox'));
  await user.click(start);
  expect(within(screen.getByRole('dialog')).getByText('编辑起点：当前执行计划 V1')).toBeTruthy();
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
  expect((screen.getByRole('radio', { name: /当前执行计划/ }) as HTMLInputElement).checked).toBe(
    true,
  );
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
  expect(screen.getByText('人工分析独立保存')).toBeTruthy();
  expect(screen.getByRole('button', { name: '采纳人工方案' })).toBeTruthy();
  expect(workbenchApi.createManualDraft).not.toHaveBeenCalled();
  expect(workbenchApi.saveManualDraft).not.toHaveBeenCalled();
});

it('shows all three metrics while switching only the Gantt reference and adopts the original AI identity', async () => {
  vi.mocked(workbenchApi.manualDraft).mockResolvedValue(ready);
  const user = userEvent.setup();
  render(<Page />);
  await user.click(await screen.findByRole('button', { name: '人工调整方案' }));
  const table = screen
    .getByRole('heading', { name: '对比决策指标' })
    .parentElement!.querySelector('table')!;
  expect(within(table).getByRole('columnheader', { name: 'AI 原线等待方案' })).toBeTruthy();
  expect(within(table).getByRole('columnheader', { name: 'AI 允许转移方案' })).toBeTruthy();
  expect(within(table).getByRole('columnheader', { name: '人工调整方案' })).toBeTruthy();
  const section = screen.getByRole('heading', { name: '3　候选排产计划' }).closest('section')!;
  const reference = within(section).getByRole('combobox', { name: '人工方案对照对象' });
  expect((reference as HTMLSelectElement).value).toBe('wait');
  await user.selectOptions(reference, 'transfer');
  expect(within(section).queryByRole('button', { name: '采纳 AI 等待方案' })).toBeNull();
  expect(within(section).getByRole('button', { name: '采纳 AI 转移方案' })).toBeTruthy();
  expect(within(section).getByLabelText('人工方案相对对照差异').textContent).toContain(
    '总延期差 120',
  );
  await user.selectOptions(reference, 'baseline');
  const baseline = within(section).getByRole('article', { name: '当前执行计划排产图' });
  expect(within(baseline).queryByRole('button', { name: /^采纳/ })).toBeNull();
  expect(workbenchApi.saveManualDraft).not.toHaveBeenCalled();
  await user.selectOptions(reference, 'transfer');
  await user.click(within(section).getByRole('button', { name: '采纳 AI 转移方案' }));
  expect(screen.getByRole('button', { name: '原 AI 方案' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(
    (screen.getByRole('combobox', { name: '本次处理的方案' }) as HTMLSelectElement).value,
  ).toBe('transfer');
  vi.mocked(workbenchApi.submitFaultReview).mockResolvedValue(workbench);
  await user.type(screen.getByRole('textbox', { name: '确认理由（必填）' }), '选择原 AI 转移候选');
  await user.click(screen.getByRole('button', { name: '提交管理者审批' }));
  expect(workbenchApi.submitFaultReview).toHaveBeenCalledWith(
    simulation.id,
    'transfer',
    '选择原 AI 转移候选',
    expect.any(String),
  );
});
