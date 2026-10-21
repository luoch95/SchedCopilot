import { render, screen } from '@testing-library/react';
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

it('shows versioned original quotations and separates them from current facts', () => {
  render(<KnowledgePanel report={report} />);
  expect(screen.getByRole('region', { name: '知识依据' })).toBeTruthy();
  expect(screen.getByText('查看原文 · 转机检查规范 · v1.0')).toBeTruthy();
  expect(screen.getByText('模拟演示资料：核对设备与模具适配。').tagName).toBe('BLOCKQUOTE');
  expect(screen.getByText('涉及2个订单。')).toBeTruthy();
  expect(screen.getByText(/不代表当前现场事实/)).toBeTruthy();
});

it('handles legacy records, missing evidence and model fallback without a blank panel', () => {
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
  expect(screen.getByText('未找到相关知识依据，保留原规则说明。')).toBeTruthy();
  expect(screen.queryByText(/查看原文/)).toBeNull();
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
  expect(screen.getByText('查看原文 · 转机检查规范 · v1.0')).toBeTruthy();
});
