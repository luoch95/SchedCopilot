import { useEffect, useRef, useState } from 'react';
import { workbenchApi } from '../workbench';
import type { ReactNode } from 'react';
import type { InsertionRequestRecord } from '../../shared/api/contracts';
import { RequestProgress } from './RequestProgress';
import { AssessmentView } from './AssessmentView';
import { InsertionProgress, useInsertionProgress } from './InsertionProgress';
import { RequestStatusTimeline } from './RequestStatusTimeline';
import { dateTime, stamp } from '../../shared/lib/time';
import { Modal } from '../../shared/ui/Modal';
import { StatusTag } from '../../shared/ui/StatusTag';
import { statusLabel } from '../../shared/lib/status';
import { WriteButton } from '../../shared/ui/WriteButton';
import { useDemoAccess } from '../../shared/lib/demoAccess';
import { inDateRange, newestFirst, type DateRange } from '../../shared/lib/dateRange';

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
  dateRange,
  headerActions,
  openRequestNo,
  onDetailsClose,
  onActed,
}: {
  refreshVersion?: number;
  planner?: boolean;
  leader?: boolean;
  disabled?: boolean;
  onPublished?: () => void;
  onSelection?: (record: InsertionRequestRecord | null, automatic?: boolean) => void;
  onOpen?: (record: InsertionRequestRecord) => void;
  requestId?: string;
  assignedPlanner?: string;
  onRecord?: (record: InsertionRequestRecord | null) => void;
  onBusyChange?: (busy: boolean) => void;
  dateRange?: DateRange;
  headerActions?: ReactNode;
  openRequestNo?: string;
  onDetailsClose?: () => void;
  onActed?: () => void;
}) {
  const { readOnly } = useDemoAccess();
  const assessmentProgress = useInsertionProgress();
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
  const reviewList = (leader || planner) && !!onOpen && !requestId;
  const [statusFilter, setStatusFilter] = useState<InsertionRequestRecord['status'] | 'all'>('all');
  const labels = {
    draft: '草稿 · 未提交审批',
    pending_approval: '待审批',
    approved: '已批准 · 待复核发布',
    rejected: '已驳回',
    published: '已发布',
  };
  const [page, setPage] = useState(1);
  const lastOpened = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!openRequestNo) {
      lastOpened.current = undefined;
      return;
    }
    if (lastOpened.current === openRequestNo) return;
    const record = records.find((item) => item.request_no === openRequestNo);
    if (record) {
      setSelected(record);
      lastOpened.current = openRequestNo;
    }
  }, [openRequestNo, records]);
  useEffect(() => {
    setPage(1);
  }, [refreshVersion]);
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
                leader || planner
                  ? item.status !== 'draft'
                  : ['pending_approval', 'approved'].includes(item.status),
              )
            : leader || planner
              ? items.filter((item) => item.status !== 'draft')
              : items;
        setRecords(visible);
        onRecord?.(visible[0] ?? null);
        onSelection?.(items.find((item) => item.assessment) ?? null, true);
      })
      .catch(() => {
        if (version === active.current) {
          setError('插单申请读取失败，请重试。');
          onSelection?.(null, true);
        }
      })
      .finally(() => {
        if (version === active.current) setLoading(false);
      });
    return () => {
      active.current += 1;
    };
  }, [
    refreshVersion,
    reload,
    onSelection,
    onOpen,
    requestId,
    onRecord,
    assignedPlanner,
    leader,
    planner,
  ]);
  async function assess(item: InsertionRequestRecord) {
    if (readOnly || locked.current || disabled) return;
    locked.current = true;
    const version = active.current;
    setAssessing(item.id);
    assessmentProgress.start();
    setAssessmentError('');
    setSavedSummary(null);
    try {
      const result = await assessmentProgress.run(item.request_no);
      if (version !== active.current) return;
      const updated = {
        ...item,
        status: item.status === 'draft' ? ('draft' as const) : ('pending_approval' as const),
        assessment: result,
        assessment_stale: false,
        approval: item.status === 'draft' ? null : { status: 'pending' },
      };
      setRecords((previous) =>
        previous.map((record) => (record.id === item.id ? updated : record)),
      );
      onSelection?.(updated);
      setReload((value) => value + 1);
    } catch (error) {
      assessmentProgress.fail();
      if (version === active.current)
        setAssessmentError(error instanceof Error ? error.message : '试排失败，请刷新后重试。');
    } finally {
      locked.current = false;
      if (version === active.current) setAssessing(null);
    }
  }
  async function act(item: InsertionRequestRecord, action: 'approve' | 'reject' | 'publish') {
    if (readOnly || locked.current || disabled) return;
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
      onActed?.();
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
        <p className="workflow-current-step">
          当前步骤：
          {item.assessment_stale && !['published', 'rejected'].includes(item.status)
            ? '试排已过期（需重新试排并重新审批）'
            : {
                draft: '试排评估（草稿，尚未提交审批）',
                pending_approval: '管理者审批（待管理者审批，尚未发布）',
                approved: '管理者审批（已批准，待排产员发布）',
                rejected: '管理者审批（已驳回，流程结束）',
                published: '排产员发布（已发布，流程完成）',
              }[item.status]}
        </p>
        {requestId && (
          <p>
            当前状态：
            <StatusTag status={item.status}>
              {labels[item.status] ?? statusLabel(item.status)}
            </StatusTag>
          </p>
        )}
        {requestId && <p>要求交期：{dateTime(item.requested_due_at)}</p>}
        <p>最早开工：{stamp(item.earliest_start_at)}</p>
        <p>紧急原因：{item.reason}</p>
        <p>
          加工时长：{item.estimate.planned_minutes} 分钟；申请时计划基线：V
          {item.plan_version}
        </p>
        <p>指派排产员：{item.assigned_planner}</p>
        <p>申请业务员：{item.applicant_id || item.applicant_name || '未记录'}</p>
        <p>提交时间：{stamp(item.created_at)}</p>
        {!leader && !['published', 'rejected'].includes(item.status) && (
          <WriteButton disabled={!!assessing || disabled} onClick={() => assess(item)}>
            {assessing === item.id ? '正在试排…' : item.assessment ? '重新试排' : '评估插单'}
          </WriteButton>
        )}
        {((leader && item.status === 'pending_approval') ||
          (planner && item.status === 'approved')) && (
          <div>
            <label>
              审批或复核理由
              <textarea
                aria-label={`审批或复核理由 ${item.request_no}`}
                disabled={readOnly}
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
                <WriteButton
                  disabled={
                    !!assessing ||
                    disabled ||
                    !item.assessment?.assessment_id ||
                    item.assessment_stale
                  }
                  onClick={() => act(item, 'approve')}
                >
                  批准插单
                </WriteButton>
                <WriteButton disabled={!!assessing || disabled} onClick={() => act(item, 'reject')}>
                  驳回申请
                </WriteButton>
              </>
            ) : (
              <WriteButton
                disabled={
                  !!assessing ||
                  disabled ||
                  !item.assessment?.assessment_id ||
                  item.assessment_stale
                }
                onClick={() => act(item, 'publish')}
              >
                复核并发布插单
              </WriteButton>
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
  const visibleRecords = requestId
    ? records
    : records
        .filter((item) => inDateRange(item.created_at, dateRange))
        .filter((item) => !reviewList || statusFilter === 'all' || item.status === statusFilter)
        .sort(
          (a, b) =>
            (reviewList
              ? Number(b.status === 'pending_approval') - Number(a.status === 'pending_approval')
              : 0) || newestFirst(a.created_at, b.created_at),
        );
  const pages = Math.max(1, Math.ceil(visibleRecords.length / 5));
  const currentPage = Math.min(page, pages);
  return (
    <section
      className={`pending-requests${!loading && !error && !visibleRecords.length && onOpen ? ' pending-requests-empty' : ''}`}
      aria-label="插单申请与状态跟踪"
    >
      <div className="sales-section-heading">
        <h3>
          {salesList
            ? '插单申请记录'
            : reviewList
              ? '插单申请审批'
              : onOpen
                ? '待审批插单申请'
                : '插单申请与状态跟踪'}
        </h3>
        <div className={`dashboard-card-actions${reviewList ? ' request-approval-actions' : ''}`}>
          {reviewList && (
            <select
              aria-label="插单申请状态"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            >
              <option value="all">全部</option>
              <option value="pending_approval">待审批</option>
              <option value="approved">已批准</option>
              <option value="rejected">已驳回</option>
              <option value="published">已发布</option>
            </select>
          )}
          {headerActions}
          <button disabled={loading || !!assessing} onClick={() => setReload((value) => value + 1)}>
            刷新申请
          </button>
        </div>
      </div>
      {!(leader && onOpen && !loading && !error && !visibleRecords.length) && (
        <p className="sales-muted">
          {assignedPlanner
            ? `当前展示指派给 ${assignedPlanner} 的申请；待审批不代表已通过交期评估或已发布排产。`
            : '演示角色共享申请列表；待审批不代表已通过交期评估或已发布排产。'}
        </p>
      )}
      <InsertionProgress progress={assessmentProgress.progress} />
      {assessmentError && <p role="alert">{assessmentError}</p>}
      {loading ? (
        <p role="status">正在读取申请…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : visibleRecords.length === 0 ? (
        <p className="sales-muted">
          {reviewList && statusFilter !== 'all'
            ? '当前筛选条件下暂无插单申请。'
            : dateRange && (dateRange.start || dateRange.end)
              ? '所选时间范围内暂无插单申请。'
              : reviewList
                ? '暂无插单申请。'
                : onOpen
                  ? '暂无待审批或待发布的插单申请。'
                  : '暂无插单申请。'}
        </p>
      ) : requestId ? (
        <article>{renderDetails(records[0])}</article>
      ) : salesList ? (
        <>
          <div className="sales-request-cards" aria-label="申请记录列表">
            {visibleRecords.slice((currentPage - 1) * 5, currentPage * 5).map((item) => (
              <article
                className="sales-request-card"
                key={item.id}
                aria-label={`申请 ${item.request_no}`}
              >
                <div className="sales-section-heading">
                  <strong>{item.request_no}</strong>
                  <StatusTag status={item.status}>
                    {labels[item.status] ?? statusLabel(item.status)}
                    {!['published', 'rejected'].includes(item.status) &&
                      (item.assessment
                        ? item.assessment_stale
                          ? ' · 试排过期'
                          : ' · 已试排'
                        : ' · 未试排')}
                  </StatusTag>
                </div>
                <p>
                  {item.product_id} / {item.quantity} 件 · 要求交期：
                  {dateTime(item.requested_due_at)}
                </p>
                <RequestProgress record={item} />
                <button disabled={disabled} onClick={() => setSelected(item)}>
                  查看详情
                </button>
              </article>
            ))}
          </div>
          <nav className="sales-request-pagination" aria-label="申请记录分页">
            <button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
              上一页
            </button>
            <span>
              第 {currentPage} / {pages} 页 · 共 {visibleRecords.length} 条
            </span>
            <button disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>
              下一页
            </button>
          </nav>
        </>
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
                {reviewList && (
                  <>
                    <th>申请业务员</th>
                    <th>要求交期</th>
                    <th>提交时间</th>
                  </>
                )}
                {!onOpen && <th>{salesList ? '操作' : '申请详情'}</th>}
              </tr>
            </thead>
            <tbody>
              {visibleRecords.map((item) => (
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
                      <td>{dateTime(item.requested_due_at)}</td>
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
                  {reviewList && (
                    <>
                      <td>{item.applicant_id || item.applicant_name || '未记录'}</td>
                      <td>{dateTime(item.requested_due_at)}</td>
                      <td>{dateTime(item.created_at)}</td>
                    </>
                  )}
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
            onDetailsClose?.();
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
