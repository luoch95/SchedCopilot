import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { KnowledgeReport } from '../api/contracts';
import { KnowledgePanel } from './KnowledgePanel';

const report: KnowledgeReport = {
  status: 'matched',
  mode: 'live',
  message: '已结合当前结果整理知识依据。',
  execution: {
    calls: 1,
    model: 'test',
    error_code: null,
    input_tokens: null,
    output_tokens: null,
    elapsed_ms: 1,
    prompt_sha256: 'hash',
  },
  sources: [
    {
      chunk_id: 'K1@1.0#1',
      document_id: 'K1',
      title: '转机检查规范',
      version: '1.0',
      section: '检查模具',
      excerpt: '模拟演示资料：核对设备与模具适配。',
      filename: 'transfer.md',
      kind: '模拟演示资料',
      content_sha256: 'hash',
    },
  ],
  items: [
    {
      source_id: 'K1@1.0#1',
      text: '建议依据检查规范复核。',
      fact_ids: ['B1'],
      related_facts: ['涉及2个订单。'],
    },
  ],
};

function expandPanel() {
  const heading = screen.getByRole('heading', { name: /参考规范与历史案例/ });
  const summary = heading.closest('summary')!;
  fireEvent.click(summary);
  return summary;
}

it('shows source cards and opens the versioned quotation with traceable identifiers', () => {
  render(<KnowledgePanel report={report} />);
  expandPanel();
  expect(screen.getByRole('region', { name: '知识依据' })).toBeTruthy();
  const card = screen.getByRole('article', { name: '转机检查规范' });
  expect(card.classList.contains('knowledge-card')).toBe(true);
  expect(within(card).getByText('《transfer.md》')).toBeTruthy();
  expect(within(card).getByText('命中片段')).toBeTruthy();
  expect(within(card).getAllByText('模拟演示资料：核对设备与模具适配。')[0].tagName).toBe(
    'BLOCKQUOTE',
  );
  expect(within(card).getByText('涉及2个订单。')).toBeTruthy();
  expect(screen.getByText(/不代表当前现场事实/)).toBeTruthy();
  const original = within(card).getByText('查看原文');
  const details = original.closest('details')!;
  expect(details.open).toBe(false);
  fireEvent.click(original);
  expect(details.open).toBe(true);
  expect(within(card).getByText(/片段编号：K1@1.0#1/)).toBeTruthy();
  expect(within(card).getByText(/文件校验值（SHA-256）：hash/)).toBeTruthy();
  expect(within(card).getByText(/转机检查规范 · v1.0/)).toBeTruthy();
  fireEvent.click(original);
  expect(details.open).toBe(false);
});

it('handles legacy records, no matches and fallback without fabricating evidence', () => {
  const { rerender } = render(<KnowledgePanel />);
  expect(screen.queryByRole('region')).toBeNull();
  rerender(
    <KnowledgePanel
      report={{
        ...report,
        status: 'no_match',
        sources: [],
        items: [],
        message: '未找到相关知识依据，保留原规则说明。',
      }}
    />,
  );
  expect(screen.getByText('（已检索 0 条依据）')).toBeTruthy();
  expandPanel();
  expect(screen.getByText('未找到相关知识依据，保留原规则说明。')).toBeTruthy();
  expect(screen.queryByText('查看原文')).toBeNull();
  expect(screen.queryByRole('region', { name: '历史相似案例' })).toBeNull();
  rerender(
    <KnowledgePanel
      report={{
        ...report,
        mode: 'fallback',
        message: '知识辅助模型暂不可用，以下直接展示检索原文，保留原规则说明。',
      }}
    />,
  );
  expect(screen.getByText(/知识辅助模型暂不可用/)).toBeTruthy();
  expect(screen.getByRole('article', { name: '转机检查规范' })).toBeTruthy();
});

it('starts collapsed with a book icon and a visible demonstration tag in the heading', () => {
  const { container } = render(<KnowledgePanel report={report} />);
  const heading = screen.getByRole('heading', { name: /参考规范与历史案例/ });
  const summary = heading.closest('summary')!;
  const details = summary.closest('details')!;
  expect(details.open).toBe(false);
  expect(summary.querySelector('.analysis-focus-icon')?.textContent).toBe('📖');
  expect(summary.querySelector('.analysis-focus-icon')?.getAttribute('aria-hidden')).toBe('true');
  expect(within(summary).getByText('模拟演示资料')).toBeTruthy();
  expect(container.querySelector('.knowledge-content')?.textContent).toContain(report.message);
  fireEvent.click(summary);
  expect(details.open).toBe(true);
  fireEvent.click(summary);
  expect(details.open).toBe(false);
});

it('counts unique retrieved passages and shows sources without model-selected items', () => {
  const second = {
    ...report.sources[0],
    chunk_id: 'K2@1.0#1',
    title: '恢复核验规范',
    filename: 'recovery.md',
  };
  const third = {
    ...report.sources[0],
    chunk_id: 'K3@1.0#1',
    title: '设备能力规范',
    filename: 'machines.md',
  };
  render(
    <KnowledgePanel report={{ ...report, sources: [...report.sources, second, third, second] }} />,
  );
  expect(screen.getByText('（已检索 3 条依据）')).toBeTruthy();
  expandPanel();
  expect(screen.getAllByRole('article')).toHaveLength(3);
  expect(screen.getByText('《recovery.md》')).toBeTruthy();
  expect(screen.getByText('《machines.md》')).toBeTruthy();
  expect(screen.queryByRole('region', { name: '历史相似案例' })).toBeNull();
});

it('separates retrieved historical cases and preserves their exact outcome and demonstration status', () => {
  const history = {
    ...report.sources[0],
    chunk_id: 'H1@1.0#1',
    title: '模拟历史案例：等待恢复与转机取舍',
    section: '历史案例只提供复核思路',
    filename: 'fault-history.md',
    excerpt: '模拟演示资料：M3 停机后，转到 M2 可能增加原订单交期延误。此案例不含实际生产数据。',
  };
  render(<KnowledgePanel report={{ ...report, sources: [...report.sources, history] }} />);
  expandPanel();
  const historicalGroup = screen.getByRole('region', { name: '历史相似案例' });
  expect(within(historicalGroup).getByRole('article', { name: history.title })).toBeTruthy();
  expect(within(historicalGroup).getAllByText(history.excerpt)).toHaveLength(2);
  expect(
    within(screen.getByRole('region', { name: '参考规范' })).queryByText(history.title),
  ).toBeNull();
  expect(screen.queryByText(/2025-11-03|零延期|采纳该方案/)).toBeNull();
  expect(screen.getByText('模拟演示资料')).toBeTruthy();
});

it('distinguishes retrieval unavailability from a completed empty search', () => {
  render(
    <KnowledgePanel
      report={{
        ...report,
        status: 'unavailable',
        sources: [],
        items: [],
        message: '知识资料暂不可用，保留原规则说明。',
      }}
    />,
  );
  expect(screen.getByText('（检索暂不可用）')).toBeTruthy();
  expect(screen.queryByText(/已检索/)).toBeNull();
  expandPanel();
  expect(screen.getByText('知识资料暂不可用，保留原规则说明。')).toBeTruthy();
  expect(screen.queryByRole('article')).toBeNull();
});
