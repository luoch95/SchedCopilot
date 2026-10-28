import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { DemoAccessBar, SessionBar } from '../session';
import { WriteButton } from '../../shared/ui/WriteButton';
import { useDemoAccess } from '../../shared/lib/demoAccess';
import { workbenchApi } from '../workbench';
import type {
  InsertionRequestRecord,
  ProcessingEstimate,
  SalesOverview,
} from '../../shared/api/contracts';
import { AssessmentView } from './AssessmentView';
import { InsertionProgress, useInsertionProgress } from './InsertionProgress';
import { PendingRequestsPanel } from './PendingRequestsPanel';
import { localInput, stamp } from '../../shared/lib/time';
import { orderLabel } from '../../shared/lib/orderLabels';
import { validateDraft, type SalesDraft, type DraftErrors } from './model';

const emptyDraft: SalesDraft = {
  productId: '',
  quantity: '',
  earliestStart: '',
  due: '',
  reason: '',
};
const referenceNotice = '试排摘要仅供参考，具体设备与工序安排将由排产计划员复核发布';
const minutes = (seconds: number) =>
  (seconds / 60).toLocaleString('zh-CN', { maximumFractionDigits: 2 });

export function SalesPage({ onSwitchRole }: { onSwitchRole: () => void }) {
  const assessmentProgress = useInsertionProgress();
  const { readOnly } = useDemoAccess();
  const [overview, setOverview] = useState<SalesOverview | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState<SalesDraft>(emptyDraft);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [estimate, setEstimate] = useState<ProcessingEstimate | null>(null);
  const [estimateError, setEstimateError] = useState('');
  const [checking, setChecking] = useState(false);
  const requestId = useRef(0);
  const checkingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [requestsVersion, setRequestsVersion] = useState(0);
  const [selectedAssessment, setSelectedAssessment] = useState<InsertionRequestRecord | null>(null);
  const formRef = useRef<HTMLElement>(null);
  const [openRequestNo, setOpenRequestNo] = useState<string | undefined>();
  const submissionKey = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const selectedId = useRef<string | null>(null);
  const draftEdited = useRef(false);

  const selectAssessment = useCallback(
    (record: InsertionRequestRecord | null, automatic = false) => {
      if (checkingRef.current || submittingRef.current) return;
      // A list refresh must not replace an in-progress draft or a just-submitted form.
      if (automatic && (draftEdited.current || selectedId.current === record?.id)) return;
      draftEdited.current = false;
      selectedId.current = record?.id ?? null;
      setSelectedAssessment(record);
      if (!record) return;
      requestId.current += 1;
      submissionKey.current = null;
      setDraft({
        productId: record.product_id,
        quantity: String(record.quantity),
        earliestStart: localInput(record.earliest_start_at),
        due: localInput(record.requested_due_at),
        reason: record.reason,
      });
      setEstimate(record.status === 'draft' ? record.estimate : null);
      setChecking(false);
      setErrors({});
      setEstimateError('');
      setSubmitError('');
      setSubmitted('');
    },
    [],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    workbenchApi
      .salesOverview()
      .then((value) => {
        if (!active) return;
        setOverview(value);
        setDraft((previous) => ({
          ...previous,
          earliestStart: previous.earliestStart || localInput(value.snapshot_time),
        }));
      })
      .catch(() => {
        if (active) setLoadError('无法读取排产概况，请确认后端服务已启动后重试。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      requestId.current += 1;
    };
  }, [loadVersion]);

  function edit(key: keyof SalesDraft, value: string) {
    assessmentProgress.reset();
    draftEdited.current = true;
    setSelectedAssessment(null);
    requestId.current += 1;
    submissionKey.current = null;
    setSubmitted('');
    setSubmitError('');
    setDraft((previous) => ({ ...previous, [key]: value }));
    setErrors({});
    setEstimate(null);
    setEstimateError('');
  }
  function refresh() {
    assessmentProgress.reset();
    requestId.current += 1;
    setEstimate(null);
    setSelectedAssessment(null);
    draftEdited.current = true;
    setChecking(false);
    setLoadVersion((value) => value + 1);
  }
  async function checkDraft(event: FormEvent) {
    event.preventDefault();
    if (readOnly || !overview || checkingRef.current || submittingRef.current || submitted) return;
    const found = validateDraft(
      draft,
      overview.products.map((item) => item.id),
      overview.snapshot_time,
    );
    setErrors(found);
    setEstimate(null);
    setEstimateError('');
    if (Object.keys(found).length) return;
    const existingDraft = selectedAssessment?.status === 'draft' ? selectedAssessment : null;
    setSelectedAssessment(null);
    draftEdited.current = true;
    const current = ++requestId.current;
    setChecking(true);
    assessmentProgress.start();
    checkingRef.current = true;
    submissionKey.current ??= crypto.randomUUID();
    try {
      const record =
        existingDraft ??
        (await workbenchApi.submitRequest({
          product_id: draft.productId,
          quantity: Number(draft.quantity),
          earliest_start_at: `${draft.earliestStart}:00+08:00`,
          requested_due_at: `${draft.due}:00+08:00`,
          reason: draft.reason.trim(),
          submission_key: submissionKey.current,
          draft_only: true,
        }));
      if (requestId.current !== current) return;
      await assessmentProgress.run(record.request_no);
      const assessed = await workbenchApi.requestDetail(record.request_no);
      if (requestId.current === current) {
        setEstimate(assessed.estimate);
        setSelectedAssessment(assessed);
        setRequestsVersion((value) => value + 1);
      }
    } catch (error) {
      assessmentProgress.fail();
      if (requestId.current === current)
        setEstimateError(
          error instanceof Error ? `插单评估失败：${error.message}` : '插单评估失败，请重试。',
        );
    } finally {
      checkingRef.current = false;
      if (requestId.current === current) setChecking(false);
    }
  }
  async function submit() {
    if (
      readOnly ||
      !overview ||
      !selectedAssessment?.assessment?.assessment_id ||
      selectedAssessment.status !== 'draft' ||
      selectedAssessment.assessment_stale ||
      checkingRef.current ||
      submittingRef.current ||
      submitted
    )
      return;
    const found = validateDraft(
      draft,
      overview.products.map((item) => item.id),
      overview.snapshot_time,
    );
    setErrors(found);
    if (Object.keys(found).length) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError('');
    submissionKey.current ??= crypto.randomUUID();
    try {
      const record = await workbenchApi.actOnRequest(
        selectedAssessment.request_no,
        'submit',
        draft.reason.trim(),
        selectedAssessment.assessment.assessment_id,
        'sales',
      );
      setSelectedAssessment(record);
      setSubmitted(record.request_no);
      setRequestsVersion((value) => value + 1);
    } catch (error) {
      setSubmitError(
        `提交失败，请重试：${error instanceof Error ? error.message : '请重新评估后提交。'}`,
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }
  const product = overview?.products.find((item) => item.id === draft.productId);
  const fieldError = (key: keyof SalesDraft) =>
    errors[key] && (
      <span className="sales-field-error" id={`${key}-error`}>
        {errors[key]}
      </span>
    );

  return (
    <main className="sales-workspace">
      <header className="page-header">
        <div>
          <WorkbenchTitle title="紧急插单" english="Urgent Order Insertion" />
          <p>填写需求，评估交期与订单影响。</p>
        </div>
        <SessionBar role="sales" onSwitch={onSwitchRole} />
      </header>
      <DemoAccessBar />
      <p className="sales-reference">{referenceNotice}</p>
      <section className="sales-panel" aria-label="插单申请记录">
        <PendingRequestsPanel
          disabled={checking || submitting}
          refreshVersion={requestsVersion}
          onSelection={selectAssessment}
          openRequestNo={openRequestNo}
          onDetailsClose={() => setOpenRequestNo(undefined)}
          headerActions={
            <button
              onClick={() => {
                assessmentProgress.reset();
                draftEdited.current = true;
                selectedId.current = null;
                setSelectedAssessment(null);
                setDraft({
                  ...emptyDraft,
                  earliestStart: localInput(overview?.snapshot_time ?? new Date().toISOString()),
                });
                setEstimate(null);
                setErrors({});
                setEstimateError('');
                setSubmitError('');
                setSubmitted('');
                submissionKey.current = null;
                requestId.current += 1;
                setChecking(false);
                formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
                formRef.current?.querySelector('select')?.focus({ preventScroll: true });
              }}
              disabled={submitting || checking}
            >
              新建插单
            </button>
          }
        />
      </section>
      <section className="sales-panel" aria-labelledby="sales-plan-heading">
        <div className="sales-section-heading">
          <div>
            <h2 id="sales-plan-heading">当前排产概况</h2>
            <p>仅展示当前执行计划中的订单交期，不代表插单后的评估结果。</p>
          </div>
          <button onClick={refresh} disabled={loading || submitting}>
            刷新概况
          </button>
        </div>
        {loading && <p role="status">正在读取排产概况…</p>}
        {loadError && (
          <div role="alert">
            <p>{loadError}</p>
            <button onClick={refresh}>重新读取</button>
          </div>
        )}
        {overview && !loading && !loadError && (
          <>
            <div className="sales-plan-facts">
              <span>
                执行计划 <strong>V{overview.plan_version}</strong>
              </span>
              <span>
                订单 <strong>{overview.orders.length} 个</strong>
              </span>
              <span>
                演示快照 <strong>{stamp(overview.snapshot_time)}</strong>
              </span>
              <span>北京时间</span>
            </div>
            <p className="sales-muted">{overview.source}</p>
            <details className="sales-orders">
              <summary>查看当前订单交期</summary>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>订单</th>
                      <th>要求交期</th>
                      <th>当前计划完成时间</th>
                      <th>当前计划延期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.orders.map((order) => (
                      <tr key={order.id}>
                        <td>
                          {orderLabel(order.display_name ?? order.id)} · {orderLabel(order.name)}
                        </td>
                        <td>{stamp(order.due)}</td>
                        <td>
                          {order.planned_completion ? stamp(order.planned_completion) : '尚未排产'}
                        </td>
                        <td>
                          {order.lateness_minutes === null
                            ? '待确认'
                            : order.lateness_minutes > 0
                              ? `${order.lateness_minutes} 分钟`
                              : '无延期'}
                        </td>
                      </tr>
                    ))}
                    {!overview.orders.length && (
                      <tr>
                        <td colSpan={4}>当前没有订单记录。</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </section>
      <div className="sales-content-grid">
        <section ref={formRef} className="sales-panel" aria-labelledby="sales-form-heading">
          <h2 id="sales-form-heading">插单需求</h2>
          <p className="sales-muted">
            填写后点击“评估插单”，查看加工时长、交期与订单影响，再提交管理者审批。
          </p>
          <form onSubmit={checkDraft} noValidate>
            <fieldset
              disabled={readOnly || !overview || loading || !!loadError || checking || submitting}
            >
              <label>
                模拟产品
                <select
                  value={draft.productId}
                  onChange={(e) => edit('productId', e.target.value)}
                  aria-invalid={!!errors.productId}
                  aria-describedby={errors.productId ? 'productId-error' : undefined}
                >
                  <option value="">请选择产品</option>
                  {overview?.products.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name} · {item.material}
                    </option>
                  ))}
                </select>
                {fieldError('productId')}
              </label>
              {product && (
                <div className="sales-product-note">
                  <strong>{product.name} · 模拟参数</strong>
                  <p>
                    每模产出 {product.units_per_cycle} 件，单模周期 {product.cycle_seconds}{' '}
                    秒，经验冗余 {product.buffer_percent}%。
                  </p>
                  <small>{overview?.product_source}</small>
                </div>
              )}
              <label>
                数量（件）
                <input
                  type="number"
                  min="1"
                  max="1000000"
                  step="1"
                  inputMode="numeric"
                  value={draft.quantity}
                  onChange={(e) => edit('quantity', e.target.value)}
                  aria-invalid={!!errors.quantity}
                  aria-describedby={errors.quantity ? 'quantity-error' : undefined}
                />
                {fieldError('quantity')}
              </label>
              <div className="sales-date-fields">
                <label>
                  最早开工时间（北京时间）
                  <input
                    type="datetime-local"
                    value={draft.earliestStart}
                    onChange={(e) => edit('earliestStart', e.target.value)}
                    aria-invalid={!!errors.earliestStart}
                    aria-describedby={errors.earliestStart ? 'earliestStart-error' : undefined}
                  />
                  {fieldError('earliestStart')}
                </label>
                <label>
                  要求交期（北京时间）
                  <input
                    type="datetime-local"
                    value={draft.due}
                    onChange={(e) => edit('due', e.target.value)}
                    aria-invalid={!!errors.due}
                    aria-describedby={errors.due ? 'due-error' : undefined}
                  />
                  {fieldError('due')}
                </label>
              </div>
              <label>
                紧急原因
                <textarea
                  maxLength={1000}
                  value={draft.reason}
                  onChange={(e) => edit('reason', e.target.value)}
                  placeholder="说明客户需求、交期要求及紧急原因"
                  aria-invalid={!!errors.reason}
                  aria-describedby={errors.reason ? 'reason-error' : undefined}
                />
                {fieldError('reason')}
              </label>
              <button type="submit" className="primary" disabled={!!submitted}>
                {checking
                  ? '正在评估插单…'
                  : estimate && selectedAssessment?.assessment
                    ? '重新评估'
                    : '评估插单'}
              </button>
            </fieldset>
          </form>
          <div aria-live="polite">
            {Object.keys(errors).length > 0 && (
              <p role="alert" className="sales-field-error">
                请修正表单中标记的问题。
              </p>
            )}
            {estimateError && <p role="alert">{estimateError}</p>}
            {estimate && (
              <section className="sales-duration" aria-labelledby="duration-heading">
                <h3 id="duration-heading">加工时长预估</h3>
                <p>已完成试排评估；审批与发布需另行操作。</p>
                <dl>
                  <div>
                    <dt>理论加工时长</dt>
                    <dd>{minutes(estimate.theoretical_seconds)} 分钟</dd>
                  </div>
                  <div>
                    <dt>经验冗余（{estimate.buffer_percent}%）</dt>
                    <dd>{minutes(estimate.buffer_seconds)} 分钟</dd>
                  </div>
                  <div>
                    <dt>计划加工时长</dt>
                    <dd>{estimate.planned_minutes} 分钟</dd>
                  </div>
                </dl>
                <details>
                  <summary>查看计算口径</summary>
                  <p>
                    批次数 = 向上取整（数量 ÷ 每模产出数量）；理论时长 = 批次数 × 单模周期。冗余 =
                    理论时长 × 经验冗余比例，两者相加后向上取整至整分钟。
                  </p>
                  <p>
                    本次共 {estimate.cycles} 模。{estimate.source}。
                  </p>
                </details>
                <p className="sales-muted">
                  换型、装模、等待及班次间隔不包含在此加工时长中，试排时按资源与日历单独计算。经验冗余用于覆盖正常波动，不保证交期；加工时长不能直接推算交付时间。
                </p>
              </section>
            )}
          </div>
        </section>
        <aside className="sales-results">
          <InsertionProgress progress={assessmentProgress.progress} />
          <section className="sales-panel" aria-labelledby="sales-impact-heading">
            <div className="sales-section-heading">
              <h2 id="sales-impact-heading">试排影响摘要</h2>
              <span className="tag">
                {selectedAssessment?.assessment
                  ? selectedAssessment.assessment_stale
                    ? '结果已过期'
                    : '已有试排结果'
                  : '尚未选择已试排申请'}
              </span>
            </div>
            {selectedAssessment?.assessment ? (
              <>
                <p>申请：{selectedAssessment.request_no}</p>
                <AssessmentView
                  result={selectedAssessment.assessment}
                  requestNo={selectedAssessment.request_no}
                  stale={selectedAssessment.assessment_stale}
                  published={selectedAssessment.status === 'published'}
                />
              </>
            ) : (
              <>
                <dl className="sales-empty-metrics">
                  <div>
                    <dt>预计完成时间</dt>
                    <dd>待评估</dd>
                  </div>
                  <div>
                    <dt>是否满足交期</dt>
                    <dd>待评估</dd>
                  </div>
                  <div>
                    <dt>受影响订单个数</dt>
                    <dd>待评估</dd>
                  </div>
                </dl>
                <details>
                  <summary>订单延期变化明细</summary>
                  <p className="sales-muted">
                    完成试排后展示原预计完成时间、试排后预计完成时间与延期变化。当前没有评估结果。
                  </p>
                </details>
                <p className="sales-muted">
                  完成时间被调整不等于新增延期。试排接入后，将区分订单调整与延期变化。
                </p>
              </>
            )}
            <p className="sales-muted">
              在左侧填写需求并点击“评估插单”，结果在此展示。修改需求后需重新评估；每条申请的结果独立保存。
            </p>
          </section>
          <section className="sales-panel" aria-labelledby="sales-status-heading">
            <h2 id="sales-status-heading">申请状态</h2>
            <p className="sales-muted">
              评估仅保存草稿。提交后进入管理者审批，批准后由排产计划员复核发布。
            </p>
            <WriteButton
              onClick={submit}
              disabled={
                !selectedAssessment?.assessment?.assessment_id ||
                selectedAssessment.status !== 'draft' ||
                !!selectedAssessment.assessment_stale ||
                checking ||
                submitting ||
                !!submitted ||
                loading ||
                !!loadError
              }
            >
              {submitting ? '正在提交…' : '提交管理者审批'}
            </WriteButton>
            {submitError && <p role="alert">{submitError}</p>}
            {submitted && (
              <div role="status">
                <p>申请 {submitted} 已保存，待审批。</p>
                <button onClick={() => setOpenRequestNo(submitted)}>查看详情</button>
              </div>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
import { WorkbenchTitle } from '../../shared/ui/WorkbenchTitle';
