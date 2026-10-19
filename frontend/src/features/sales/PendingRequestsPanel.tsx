import { useEffect, useRef, useState } from 'react';
import { workbenchApi } from '../workbench';
import type { InsertionRequestRecord } from '../../shared/api/contracts';
import { AssessmentView } from './AssessmentView';
import { stamp } from '../../shared/lib/time';

export function PendingRequestsPanel({
  refreshVersion = 0,
  planner = false,
  leader = false,
  disabled = false,
  onPublished,
  onSelection,
}: {
  refreshVersion?: number;
  planner?: boolean;
  leader?: boolean;
  disabled?: boolean;
  onPublished?: () => void;
  onSelection?: (record: InsertionRequestRecord | null) => void;
}) {
  const [records, setRecords] = useState<InsertionRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [assessing, setAssessing] = useState<string | null>(null);
  const [assessmentError, setAssessmentError] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const labels = {
    pending_approval: '待审批',
    approved: '已批准 · 待复核发布',
    rejected: '已驳回',
    published: '已发布',
  };
  const active = useRef(0);
  const locked = useRef(false);
  useEffect(() => {
    const version = ++active.current;
    setLoading(true);
    setError('');
    workbenchApi
      .pendingRequests()
      .then((items) => {
        if (version !== active.current) return;
        setRecords(items);
        onSelection?.(items.find((item) => item.assessment) ?? null);
      })
      .catch(() => {
        if (version === active.current) {
          setError('插单申请读取失败，请重试。');
          onSelection?.(null);
        }
      })
      .finally(() => {
        if (version === active.current) setLoading(false);
      });
    return () => {
      active.current += 1;
    };
  }, [refreshVersion, reload, onSelection]);
  async function assess(item: InsertionRequestRecord) {
    if (locked.current || disabled) return;
    locked.current = true;
    const version = active.current;
    setAssessing(item.id);
    setAssessmentError('');
    try {
      const result = await workbenchApi.assessRequest(item.id);
      if (version !== active.current) return;
      const updated = {
        ...item,
        status: 'pending_approval' as const,
        assessment: result,
        assessment_stale: false,
        approval: { status: 'pending' },
      };
      setRecords((previous) =>
        previous.map((record) => (record.id === item.id ? updated : record)),
      );
      onSelection?.(updated);
      setReload((value) => value + 1);
    } catch (error) {
      if (version === active.current)
        setAssessmentError(error instanceof Error ? error.message : '试排失败，请刷新后重试。');
    } finally {
      locked.current = false;
      if (version === active.current) setAssessing(null);
    }
  }
  async function act(item: InsertionRequestRecord, action: 'approve' | 'reject' | 'publish') {
    if (locked.current || disabled) return;
    const reason = reasons[item.id]?.trim();
    if (!reason) {
      setAssessmentError('请填写审批或复核理由。');
      return;
    }
    locked.current = true;
    const version = active.current;
    setAssessing(item.id);
    setAssessmentError('');
    try {
      await workbenchApi.actOnRequest(
        item.id,
        action,
        reason,
        item.assessment?.assessment_id,
        planner ? 'planner' : 'leader',
      );
      if (version !== active.current) return;
      setReload((value) => value + 1);
      if (action === 'publish') onPublished?.();
    } catch (error) {
      if (version === active.current)
        setAssessmentError(error instanceof Error ? error.message : '操作失败，请刷新。');
    } finally {
      locked.current = false;
      if (version === active.current) setAssessing(null);
    }
  }
  return (
    <section className="pending-requests" aria-label="插单申请与状态跟踪">
      <div className="sales-section-heading">
        <h3>插单申请与状态跟踪</h3>
        <button disabled={loading || !!assessing} onClick={() => setReload((value) => value + 1)}>
          刷新申请
        </button>
      </div>
      <p className="sales-muted">演示角色共享申请列表；待审批不代表已通过交期评估或已发布排产。</p>
      {assessmentError && <p role="alert">{assessmentError}</p>}
      {loading ? (
        <p role="status">正在读取申请…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : records.length === 0 ? (
        <p>暂无插单申请。</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>申请编号</th>
                <th>产品 / 数量</th>
                <th>要求交期</th>
                <th>状态</th>
                <th>申请详情</th>
              </tr>
            </thead>
            <tbody>
              {records.map((item) => (
                <tr key={item.id}>
                  <td>{item.request_no}</td>
                  <td>
                    {item.product_id} / {item.quantity} 件
                  </td>
                  <td>{stamp(item.requested_due_at)}</td>
                  <td>
                    {labels[item.status]}
                    {item.status !== 'published' && item.status !== 'rejected' && (
                      <>
                        {' '}
                        ·{' '}
                        {item.assessment
                          ? item.assessment_stale
                            ? '试排过期'
                            : '已试排'
                          : '未试排'}
                      </>
                    )}
                  </td>
                  <td>
                    <details>
                      <summary>查看需求</summary>
                      <p>最早开工：{stamp(item.earliest_start_at)}</p>
                      <p>紧急原因：{item.reason}</p>
                      <p>
                        加工时长：{item.estimate.planned_minutes} 分钟；申请时计划基线：V
                        {item.plan_version}
                      </p>
                      <p>提交时间：{stamp(item.created_at)}</p>
                      {!leader && !['published', 'rejected'].includes(item.status) && (
                        <button disabled={!!assessing || disabled} onClick={() => assess(item)}>
                          {assessing === item.id
                            ? '正在试排…'
                            : item.assessment
                              ? '重新试排'
                              : '评估插单'}
                        </button>
                      )}
                      {((leader && item.status === 'pending_approval') ||
                        (planner && item.status === 'approved')) && (
                        <div>
                          <label>
                            审批或复核理由
                            <textarea
                              aria-label={`审批或复核理由 ${item.request_no}`}
                              value={reasons[item.id] ?? ''}
                              onChange={(event) =>
                                setReasons((previous) => ({
                                  ...previous,
                                  [item.id]: event.target.value,
                                }))
                              }
                            />
                          </label>
                          {leader ? (
                            <>
                              <button
                                disabled={
                                  !!assessing ||
                                  disabled ||
                                  !item.assessment?.assessment_id ||
                                  item.assessment_stale
                                }
                                onClick={() => act(item, 'approve')}
                              >
                                批准插单
                              </button>
                              <button
                                disabled={!!assessing || disabled}
                                onClick={() => act(item, 'reject')}
                              >
                                驳回申请
                              </button>
                            </>
                          ) : (
                            <button
                              disabled={
                                !!assessing ||
                                disabled ||
                                !item.assessment?.assessment_id ||
                                item.assessment_stale
                              }
                              onClick={() => act(item, 'publish')}
                            >
                              复核并发布插单
                            </button>
                          )}
                          {item.assessment_stale && <p>试排已过期，须重新试排并重新审批。</p>}
                        </div>
                      )}
                      {item.approval?.reason && <p>审批意见：{item.approval.reason}</p>}
                      {!!item.status_history?.length && (
                        <details>
                          <summary>状态历史</summary>
                          {item.status_history.map((entry, index) => (
                            <p key={index}>
                              {stamp(entry.created_at)} · {entry.operator_role} ·{' '}
                              {entry.from_status} → {entry.to_status}：{entry.comment}
                            </p>
                          ))}
                        </details>
                      )}
                      {item.assessment &&
                        (onSelection ? (
                          <button onClick={() => onSelection(item)}>查看试排摘要</button>
                        ) : (
                          <AssessmentView
                            result={item.assessment}
                            planner={planner}
                            stale={item.assessment_stale}
                            published={item.status === 'published'}
                          />
                        ))}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
