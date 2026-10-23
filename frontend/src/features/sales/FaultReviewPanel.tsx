import { useState } from 'react';
import type { Workbench } from '../../shared/api/contracts';
import { WriteButton } from '../../shared/ui/WriteButton';
import { ContributionReport } from '../../shared/ui/ContributionReport';
import { workbenchApi } from '../workbench';

export function FaultReviewPanel({
  state,
  onChange,
}: {
  state: Workbench;
  onChange: (value: Workbench) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const review = state.fault_review;
  if (!review) return null;
  async function act(action: 'approve' | 'reject') {
    if (!review || busy || !reason.trim()) return;
    setBusy(true);
    setError('');
    try {
      onChange(await workbenchApi.reviewFault(review.id, action, reason.trim()));
      setReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '审批未完成，请刷新后重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="fault-review-panel" aria-label="故障方案审批">
      <h3>
        故障方案审批 ·{' '}
        {review.status === 'pending'
          ? '待审批'
          : review.status === 'approved'
            ? review.kind === 'assessment'
              ? '评估结论已批准'
              : '已批准，待排产员发布'
            : review.status === 'published'
              ? '已发布'
              : review.status === 'superseded'
                ? '已失效，需重新提交'
                : '已退回'}
      </h3>
      <p>
        <strong>{review.candidate_label}</strong>
        {review.metrics && (
          <>
            {' '}
            · 总延期 {review.metrics.total_lateness_minutes} 分钟 · 调整{' '}
            {review.metrics.moved_operations} 道工序
          </>
        )}
      </p>
      {review.assessment && (
        <>
          <p>{review.assessment.summary}</p>
          <ul>
            {review.assessment.findings.map((item, i) => (
              <li key={i}>{item.text}</li>
            ))}
          </ul>
          <ul>
            {review.assessment.recommendations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {review.assessment.limitations.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </>
      )}
      <p>提交理由：{review.reason}</p>
      <ContributionReport
        report={review.analysis?.report ?? review.workflow?.contribution_report}
      />
      {review.review_reason && <p>审批意见：{review.review_reason}</p>}
      {review.status === 'pending' && (
        <fieldset disabled={busy}>
          <label>
            审批意见（必填）
            <textarea value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="inline-actions">
            <WriteButton disabled={!reason.trim() || busy} onClick={() => void act('reject')}>
              退回修改
            </WriteButton>
            <WriteButton
              className="primary"
              disabled={!reason.trim() || busy}
              onClick={() => void act('approve')}
            >
              {review.kind === 'assessment' ? '同意评估结论' : '同意方案并交回排产员'}
            </WriteButton>
          </div>
        </fieldset>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
