import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ContributionReport } from './ContributionReport';
import type { ContributionReport as Report } from '../api/contracts';
import { simulation } from '../../test/fixtures';

const report: Report = {
  title: '人工调整草案报告',
  revision: 3,
  manual_summary: '已进行人工排程调整。',
  edits: [],
  risks: ['人员配置尚未核验。'],
  decision: '待审批，尚未发布。',
  model: {
    mode: 'live',
    error_code: null,
    highlights: [{ text: '逐工序的完整技术说明', evidence_refs: ['source'] }],
  },
};

function impact(id: string, before: number, after: number) {
  return {
    ...simulation.candidates[0].order_impacts[0],
    订单: id,
    '原延期(分钟)': before,
    '新延期(分钟)': after,
    '新增延期(分钟)': after - before,
  };
}

it('summarizes saved R3 order results and collapses verbose model details without changing data', () => {
  const saved = { ...report, order_impacts: [impact('O1004', 60, 60), impact('O1005', 105, 155)] };
  const original = JSON.stringify(saved);
  render(<ContributionReport report={saved} />);
  const summary = screen.getByLabelText('评估结果总结');
  expect(summary.textContent).toContain('共 2 个订单延期，总延期 215 分钟');
  expect(summary.textContent).toContain('基线的 165 分钟，增加 50 分钟');
  expect(summary.textContent).toContain('延期最多的是订单 O1005，延期 155 分钟');
  for (const text of [
    '2 个订单延期',
    '215 分钟',
    '增加 50 分钟',
    'O1005',
    '155 分钟',
    '按总延期指标，本方案未优于执行计划基线。',
  ]) {
    expect(within(summary).getByText(text).tagName).toBe('STRONG');
  }
  const details = screen.getByText('查看评估依据与工序明细').closest('details');
  expect(details?.open).toBe(false);
  expect(details?.textContent).toContain('逐工序的完整技术说明');
  expect(screen.getByText(/人员配置尚未核验/)).toBeTruthy();
  expect(screen.getByText('待审批，尚未发布。')).toBeTruthy();
  expect(JSON.stringify(saved)).toBe(original);
});

it.each([
  [105, 55, '减少 50 分钟', '按总延期指标，本方案优于执行计划基线。'],
  [60, 60, '保持不变', '按总延期指标，本方案与执行计划基线持平。'],
  [0, 0, '共 0 个订单延期，总延期 0 分钟', '按总延期指标，本方案与执行计划基线持平。'],
])('summarizes baseline %s and result %s accurately', (before, after, expected, conclusion) => {
  render(
    <ContributionReport report={{ ...report, order_impacts: [impact('O1005', before, after)] }} />,
  );
  expect(screen.getByLabelText('评估结果总结').textContent).toContain(expected);
  expect(screen.getByLabelText('评估结果总结').textContent).toContain(conclusion);
  if (!after) expect(screen.queryByText(/延期最多的是订单/)).toBeNull();
});

it('does not fabricate zero metrics when historical order results are missing', () => {
  render(<ContributionReport report={report} />);
  expect(screen.queryByLabelText('评估结果总结')).toBeNull();
  expect(screen.getByText('查看评估依据与工序明细')).toBeTruthy();
  expect(screen.getByText('评估可信度：暂无法量化')).toBeTruthy();
  expect(screen.getByRole('region', { name: '延期结果' }).textContent).toContain('无法确认');
});

it('uses the selected candidate rather than another report result and labels predictions', () => {
  const saved = { ...report, order_impacts: [impact('OTHER', 0, 999)] };
  const selected = {
    ...simulation.candidates[0],
    order_impacts: [impact('SELECTED', 165, 165)],
  };
  const view = render(<ContributionReport report={saved} candidate={selected} published />);
  expect(screen.getByLabelText('评估结果总结').textContent).toContain('总延期 165 分钟');
  expect(screen.queryByText('OTHER')).toBeNull();
  expect(screen.getByText('已发布方案的预计结果，不代表实际生产完成情况。')).toBeTruthy();
  view.rerender(<ContributionReport report={saved} candidate={selected} />);
  expect(screen.getByText('预计结果，不代表实际生产完成情况。')).toBeTruthy();
});

it('keeps order increases visible even when total delay is unchanged', () => {
  render(
    <ContributionReport
      report={{ ...report, order_impacts: [impact('A', 0, 30), impact('B', 60, 30)] }}
    />,
  );
  expect(screen.getByText('1 个订单延期增加')).toBeTruthy();
  expect(screen.queryByText('未新增订单延期')).toBeNull();
  expect(screen.getByLabelText('评估结果总结').textContent).toContain('保持不变');
});
