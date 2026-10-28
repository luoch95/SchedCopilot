import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { InsertionRequestRecord, InsertionAssessment } from '../../shared/api/contracts';
import { RequestProgress } from './RequestProgress';

const base = { status: 'pending_approval' } as InsertionRequestRecord;
const assessment = {} as InsertionAssessment;
describe('request progress from authoritative request state', () => {
  it.each([
    [{ ...base, status: 'draft' }, '试排评估'],
    [{ ...base, status: 'draft', assessment }, '提交管理者审批'],
    [{ ...base }, '试排评估'],
    [{ ...base, assessment }, '管理者审批'],
    [{ ...base, assessment, status: 'approved' }, '排产员复核发布'],
    [{ ...base, assessment, status: 'approved', assessment_stale: true }, '试排评估'],
  ] as [InsertionRequestRecord, string][])(
    'highlights the pending step for %j',
    (record, expected) => {
      render(<RequestProgress record={record} />);
      const current = screen.getByText(expected).closest('li')!;
      expect(current.getAttribute('aria-current')).toBe('step');
      expect(within(current).getByText('待处理')).toBeTruthy();
      if (record.assessment_stale) expect(screen.getByText(/需重新试排并重新审批/)).toBeTruthy();
    },
  );
  it('keeps published history complete even if an old stale flag is present', () => {
    render(
      <RequestProgress
        record={{ ...base, assessment, status: 'published', assessment_stale: true }}
      />,
    );
    expect(screen.getAllByText('已完成')).toHaveLength(4);
    expect(screen.queryByText('待处理')).toBeNull();
    expect(screen.queryByText(/已过期/)).toBeNull();
  });
  it('ends a rejected request without claiming it was published', () => {
    render(<RequestProgress record={{ ...base, status: 'rejected' }} />);
    expect(screen.getByText('管理者审批').closest('li')?.className).toBe(
      'request-progress-rejected',
    );
    expect(screen.getByText('排产员复核发布').closest('li')?.className).toBe(
      'request-progress-waiting',
    );
    expect(screen.queryByText('待处理')).toBeNull();
  });
});
