import { useEffect, useState } from 'react';
import type { Workbench } from '../../shared/api/contracts';
import { WriteButton } from '../../shared/ui/WriteButton';
import { FaultAnalysisDetails } from '../analysis';
import { workbenchApi } from '../workbench';

export function FaultReviewPanel({
  state,
  onChange,
  onBusyChange,
}: {
  state: Workbench;
  onChange: (value: Workbench) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const summary = state.fault_review;
  const [loaded, setLoaded] = useState<Workbench['fault_review']>(null);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoaded(null);
    setLoadError('');
    if (summary) {
      void workbenchApi
        .faultReviewDetail(summary.id)
        .then((detail) => {
          if (!active) return;
          if (
            detail.id !== summary.id ||
            detail.status !== summary.status ||
            detail.event_revision !== summary.event_revision ||
            detail.baseline_fingerprint !== summary.baseline_fingerprint
          ) {
            throw new Error('审批详情与当前申请不匹配，请同步最新数据。');
          }
          if (
            detail.kind === 'assessment'
              ? !detail.assessment || !detail.workflow
              : !detail.analysis?.simulation ||
                !detail.analysis.simulation.candidates.some(
                  (candidate) => candidate.id === detail.candidate_id,
                )
          ) {
            throw new Error('该审批缺少完整评估记录，请排产员重新评估并提交。');
          }
          setLoaded(detail);
        })
        .catch((err) => {
          if (active)
            setLoadError(err instanceof Error ? err.message : '审批详情加载失败，请重试。');
        });
    }
    return () => {
      active = false;
    };
  }, [summary?.id, summary?.status, summary?.event_revision, summary?.baseline_fingerprint, retry]);
  const ready =
    !!loaded &&
    loaded.id === summary?.id &&
    loaded.status === summary?.status &&
    loaded.event_revision === summary?.event_revision &&
    loaded.baseline_fingerprint === summary?.baseline_fingerprint;
  const review = ready ? loaded : summary;

  if (!review) return null;
  async function act(action: 'approve' | 'reject') {
    if (!review || !ready || busy || !reason.trim()) return;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      onChange(await workbenchApi.reviewFault(review.id, action, reason.trim()));
      setReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '审批未完成，请刷新后重试。');
    } finally {
      setBusy(false);
      onBusyChange?.(false);
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
      {!ready && !loadError && <p role="status">正在加载审批评估详情…</p>}
      {loadError && (
        <div role="alert">
          <p>{loadError}</p>
          <button onClick={() => setRetry((value) => value + 1)}>重试加载详情</button>
        </div>
      )}
      {ready && (
        <FaultAnalysisDetails
          state={{
            ...state,
            fault_review: review,
            plan_publication: undefined,
            event_revision: review.event_revision,
            baseline: review.analysis?.baseline ?? state.baseline,
            affected: review.analysis?.affected ?? state.affected,
          }}
          workflow={review.analysis?.workflow ?? review.workflow ?? null}
          simulation={review.analysis?.simulation}
        />
      )}
      {review.review_reason && <p>审批意见：{review.review_reason}</p>}
      {review.status === 'pending' && (
        <fieldset disabled={busy || !ready}>
          <label>
            审批意见（必填）
            <textarea value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="inline-actions">
            <WriteButton
              disabled={!ready || !reason.trim() || busy}
              onClick={() => void act('reject')}
            >
              退回修改
            </WriteButton>
            <WriteButton
              className="primary"
              disabled={!ready || !reason.trim() || busy}
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
