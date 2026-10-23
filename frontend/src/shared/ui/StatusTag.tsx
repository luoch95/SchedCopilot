import type { ReactNode } from 'react';
import { statusPresentation } from '../lib/status';

export function StatusTag({ status, children }: { status: string; children?: ReactNode }) {
  const { label, tone } = statusPresentation(status);
  return <span className={`status-tag status-tag-${tone}`}>{children ?? label}</span>;
}
