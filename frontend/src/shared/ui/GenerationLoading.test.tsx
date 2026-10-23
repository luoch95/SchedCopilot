import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { GenerationLoading } from './GenerationLoading';

it('shows a compact loading message only while the request is running', () => {
  const { rerender } = render(<GenerationLoading running />);
  expect(screen.getByRole('status').textContent).toBe('正在生成方案…');
  expect(screen.queryByRole('progressbar')).toBeNull();
  rerender(<GenerationLoading running={false} />);
  expect(screen.queryByRole('status')).toBeNull();
  rerender(<GenerationLoading running />);
  expect(screen.getByRole('status')).toBeTruthy();
});
