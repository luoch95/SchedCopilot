import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { AnalysisPanel } from './AnalysisPanel';
import type { WorkflowResult, CopilotAnswer } from '../../shared/api/contracts';

const result: WorkflowResult = {
  id: 'w1',
  intent: 'generate_candidates',
  status: 'completed',
  failure_code: null,
  trace: [],
  results: {},
  evidence_catalog: {},
};

it('fills shortcuts without calling AI and submits only the question action', async () => {
  const ask = vi.fn();
  function Assist() {
    const [question, setQuestion] = useState('');
    return (
      <AnalysisPanel
        busy=""
        result={result}
        question={question}
        onQuestion={setQuestion}
        onExplain={ask}
      />
    );
  }
  const user = userEvent.setup();
  render(<Assist />);
  expect(
    (screen.getByRole('button', { name: '✨ 获取 AI 解答' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await user.click(screen.getByRole('button', { name: '如果不转移会怎样？' }));
  expect((screen.getByLabelText('解释问题') as HTMLTextAreaElement).value).toBe(
    '如果不转移会怎样？',
  );
  expect(ask).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '✨ 获取 AI 解答' }));
  expect(ask).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: /重新生成/ })).toBeNull();
});

it('renders a separate Markdown answer and ignores raw HTML and unsafe links', () => {
  const answer: CopilotAnswer = {
    workflow_id: 'w1',
    question: '延期风险？',
    mode: 'fallback',
    answer:
      '## 风险依据\n\n**延期 60 分钟**\n\n- 请人工确认\n\n<script>alert(1)</script>\n\n[危险链接](javascript:alert%281%29)',
    execution: { calls: 0, error_code: 'MODEL_NOT_CONFIGURED' },
    knowledge: { status: 'no_match', message: '未找到相关知识依据', sources: [] },
  };
  const { container } = render(
    <AnalysisPanel
      busy=""
      result={result}
      question="问题"
      onQuestion={() => {}}
      onExplain={() => {}}
      answer={answer}
    />,
  );
  const response = screen.getByRole('region', { name: 'AI 解答' });
  expect(within(response).getByRole('heading', { name: '风险依据' })).toBeTruthy();
  expect(response.querySelector('strong')?.textContent).toContain('Copilot');
  expect(within(response).getByRole('listitem').textContent).toBe('请人工确认');
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('a')?.getAttribute('href')).not.toContain('javascript:');
});
