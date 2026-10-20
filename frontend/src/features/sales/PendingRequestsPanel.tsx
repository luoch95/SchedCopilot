import { useEffect, useRef, useState } from 'react';
import { workbenchApi } from '../workbench';
import type { InsertionRequestRecord } from '../../shared/api/contracts';
import { AssessmentView } from './AssessmentView';
import { RequestStatusTimeline } from './RequestStatusTimeline';
import { stamp } from '../../shared/lib/time';
import { Modal } from '../../shared/ui/Modal';
import { StatusTag } from '../../shared/ui/StatusTag';
import { statusLabel } from '../../shared/lib/status';

export function PendingRequestsPanel({
  refreshVersion = 0,
  planner = false,
  leader = false,
  disabled = false,
  onPublished,
  onSelection,
  onOpen,
  requestId,
  assignedPlanner,
  onRecord,
  onBusyChange,
}: {
  refreshVersion?: number;
  planner?: boolean;
  leader?: boolean;
  disabled?: boolean;
  onPublished?: () => void;
  onSelection?: (record: InsertionRequestRecord | null) => void;
  onOpen?: (record: InsertionRequestRecord) => void;
  requestId?: string;
  assignedPlanner?: string;
  onRecord?: (record: InsertionRequestRecord | null) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [records, setRecords] = useState<InsertionRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [assessing, setAssessing] = useState<string | null>(null);
  const [assessmentError, setAssessmentError] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<InsertionRequestRecord | null>(null);
  const [drawerBusy, setDrawerBusy] = useState(false);
  const [savedSummary, setSavedSummary] = useState<InsertionRequestRecord | null>(null);
  const salesList = !!onSelection && !requestId;
  const labels = {
    pending_approval: '待审批',
    approved: '已批准 · 待复核发布',
    rejected: '已驳回',
    published: '已发布',
  };
  const active = useRef(0);
  const locked = useRef(false);
  useEffect(() => {
    onBusyChange?.(!!assessing);
  }, [assessing, onBusyChange]);
  useEffect(() => {
    const version = ++active.current;
    setLoading(true);
    setError('');
    (requestId
      ? workbenchApi.requestDetail(requestId).then((record) => [record])
      : workbenchApi.pendingRequests(assignedPlanner)
    )
      .then((items) => {
        if (version !== active.current) return;
        const visible = requestId
          ? items.filter((item) => item.request_no === requestId)
          : onOpen
            ? items.filter((item) =>
                leader
                  ? item.status === 'pending_approval'
                  : ['pending_approval', 'approved'].includes(item.status),
              )
            : items;
        setRecords(visible);
        onRecord?.(visible[0] ?? null);
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
  }, [refreshVersion, reload, onSelection, onOpen, requestId, onRecord, assignedPlanner, leader]);
  async function assess(item: InsertionRequestRecord) {
    if (locked.current || disabled) return;
    locked.current = true;
    const version = active.current;
    setAssessing(item.id);
    setAssessmentError('');
    setSavedSummary(null);
    try {
      const result = await workbenchApi.assessRequest(item.request_no);
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
        item.request_no,
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
  async function viewSummary(item: InsertionRequestRecord) {
    if (locked.current) return;
    locked.current = true;
    setAssessing(item.id);
    setAssessmentError('');
    setSavedSummary(null);
    const version = active.current;
    try {
      const record = await workbenchApi.requestDetail(item.request_no);
      if (version !== active.current) return;
      if (!record.assessment) throw new Error('该申请尚无已保存的试排结果，请先评估插单。');
      setSavedSummary(record);
      onSelection?.(record);
    } catch (error) {
      if (version === active.current)
        setAssessmentError(error instanceof Error ? error.message : '试排摘要读取失败，请重试。');
    } finally {
      locked.current = false;
      if (version === active.current) setAssessing(null);
    }
  }
  function renderDetails(item: InsertionRequestRecord) {
    return (
      <div className="request-detail-content">
        <h4>申请需求</h4>
        {requestId && (
          <p>
            当前状态：
            <StatusTag status={item.status}>
              {labels[item.status] ?? statusLabel(item.status)}
            </StatusTag>
          </p>
        )}
        {requestId && <p>要求交期：{stamp(item.requested_due_at)}</p>}
        <p>最早开工：{stamp(item.earliest_start_at)}</p>
        <p>紧急原因：{item.reason}</p>
        <p>
          加工时长：{item.estimate.planned_minutes} 分钟；申请时计划基线：V
          {item.plan_version}
        </p>
        <p>指派排产员：{item.assigned_planner}</p>
        <p>提交时间：{stamp(item.created_at)}</p>
        {!leader && !['published', 'rejected'].includes(item.status) && (
          <button disabled={!!assessing || disabled} onClick={() => assess(item)}>
            {assessing === item.id ? '正在试排…' : item.assessment ? '重新试排' : '评估插单'}
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
                <button disabled={!!assessing || disabled} onClick={() => act(item, 'reject')}>
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
            <RequestStatusTimeline history={item.status_history} />
          </details>
        )}
        {item.assessment &&
          (onSelection ? (
            <>
              <button disabled={!!assessing} onClick={() => viewSummary(item)}>
                {assessing === item.id ? '正在读取摘要…' : '查看试排摘要'}
              </button>
              {savedSummary?.id === item.id && savedSummary.assessment && (
                <AssessmentView
                  result={savedSummary.assessment}
                  requestNo={savedSummary.request_no}
                  stale={savedSummary.assessment_stale}
                  published={savedSummary.status === 'published'}
                />
              )}
            </>
          ) : (
            <AssessmentView
              result={item.assessment}
              requestNo={item.request_no}
              planner={planner}
              stale={item.assessment_stale}
              published={item.status === 'published'}
            />
          ))}
      </div>
    );
  }
  return (
    <section
      className={`pending-requests${!loading && !error && !records.length && onOpen ? ' pending-requests-empty' : ''}`}
      aria-label="插单申请与状态跟踪"
    >
      <div className="sales-section-heading">
        <h3>{onOpen ? '待审批插单申请' : '插单申请与状态跟踪'}</h3>
        <button disabled={loading || !!assessing} onClick={() => setReload((value) => value + 1)}>
          刷新申请
        </button>
      </div>
      {!(leader && onOpen && !loading && !error && !records.length) && (
        <p className="sales-muted">
          {assignedPlanner
            ? `当前展示指派给 ${assignedPlanner} 的申请；待审批不代表已通过交期评估或已发布排产。`
            : '演示角色共享申请列表；待审批不代表已通过交期评估或已发布排产。'}
        </p>
      )}
      {assessmentError && <p role="alert">{assessmentError}</p>}
      {loading ? (
        <p role="status">正在读取申请…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : records.length === 0 ? (
        <p className="sales-muted">
          {leader && onOpen
            ? '暂无待审批工单'
            : onOpen
              ? '暂无待审批或待发布的插单申请。'
              : '暂无插单申请。'}
        </p>
      ) : requestId ? (
        <article>{renderDetails(records[0])}</article>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>申请编号</th>
                {onOpen ? (
                  <>
                    <th>产品</th>
                    <th>数量</th>
                  </>
                ) : (
                  <>
                    <th>产品 / 数量</th>
                    <th>要求交期</th>
                  </>
                )}
                <th className="status-column">状态</th>
                {!onOpen && <th>{salesList ? '操作' : '申请详情'}</th>}
              </tr>
            </thead>
            <tbody>
              {records.map((item) => (
                <tr
                  key={item.id}
                  className={onOpen ? 'request-row' : undefined}
                  onClick={
                    onOpen
                      ? () => {
                          if (!disabled) onOpen(item);
                        }
                      : undefined
                  }
                >
                  <td>
                    {onOpen ? (
                      <button
                        className="request-link"
                        disabled={disabled}
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(item);
                        }}
                      >
                        {item.request_no}
                      </button>
                    ) : (
                      item.request_no
                    )}
                  </td>
                  {onOpen ? (
                    <>
                      <td>{item.product_id}</td>
                      <td>{item.quantity}</td>
                    </>
                  ) : (
                    <>
                      <td>
                        {item.product_id} / {item.quantity} 件
                      </td>
                      <td>{stamp(item.requested_due_at)}</td>
                    </>
                  )}
                  <td className="status-column">
                    <StatusTag status={item.status}>
                      {labels[item.status] ?? statusLabel(item.status)}
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
                    </StatusTag>
                  </td>
                  {!onOpen && (
                    <td>
                      {salesList ? (
                        <button disabled={disabled} onClick={() => setSelected(item)}>
                          查看详情
                        </button>
                      ) : (
                        <details>
                          <summary>查看需求</summary>
                          {renderDetails(item)}
                        </details>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && salesList && (
        <Modal
          drawer
          drawerWidth="50vw"
          title="插单申请详情"
          busy={drawerBusy}
          onClose={() => {
            setSelected(null);
            setReload((value) => value + 1);
          }}
        >
          <p className="console-request-context">
            {selected.request_no} · {selected.product_id} / {selected.quantity} 件
          </p>
          <PendingRequestsPanel
            requestId={selected.request_no}
            onSelection={onSelection}
            onBusyChange={setDrawerBusy}
            disabled={disabled}
          />
        </Modal>
      )}
    </section>
  );
}
