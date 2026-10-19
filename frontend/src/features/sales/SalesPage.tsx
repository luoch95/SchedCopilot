import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SessionBar } from '../session';
import { workbenchApi } from '../workbench';
import type {
  InsertionRequestRecord,
  ProcessingEstimate,
  SalesOverview,
} from '../../shared/api/contracts';
import { AssessmentView } from './AssessmentView';
import { PendingRequestsPanel } from './PendingRequestsPanel';
import { localInput, stamp } from '../../shared/lib/time';
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
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [requestsVersion, setRequestsVersion] = useState(0);
  const [selectedAssessment, setSelectedAssessment] = useState<InsertionRequestRecord | null>(null);
  const submissionKey = useRef<string | null>(null);
  const submittingRef = useRef(false);

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
    requestId.current += 1;
    setEstimate(null);
    setChecking(false);
    setLoadVersion((value) => value + 1);
  }
  async function checkDraft(event: FormEvent) {
    event.preventDefault();
    if (!overview || checking) return;
    const found = validateDraft(
      draft,
      overview.products.map((item) => item.id),
      overview.snapshot_time,
    );
    setErrors(found);
    setEstimate(null);
    setEstimateError('');
    if (Object.keys(found).length) return;
    const current = ++requestId.current;
    setChecking(true);
    try {
      const result = await workbenchApi.processingEstimate(draft.productId, Number(draft.quantity));
      if (requestId.current === current) setEstimate(result);
    } catch {
      if (requestId.current === current) setEstimateError('加工时长预估失败，请稍后重试。');
    } finally {
      if (requestId.current === current) setChecking(false);
    }
  }
  async function submit() {
    if (!overview || !estimate || submittingRef.current || submitted) return;
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
      const record = await workbenchApi.submitRequest({
        product_id: draft.productId,
        quantity: Number(draft.quantity),
        earliest_start_at: `${draft.earliestStart}:00+08:00`,
        requested_due_at: `${draft.due}:00+08:00`,
        reason: draft.reason.trim(),
        submission_key: submissionKey.current,
      });
      setSubmitted(record.request_no);
      setRequestsVersion((value) => value + 1);
    } catch {
      setSubmitError('提交失败，请重试；重复点击不会重复创建同一申请。');
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
          <p className="eyebrow">订单需求 · 演示工作空间</p>
          <h1>紧急插单</h1>
          <p>先填写需求，再了解交期与订单影响。</p>
        </div>
        <SessionBar role="sales" onSwitch={onSwitchRole} />
      </header>
      <p className="sales-reference">{referenceNotice}</p>
      <section className="sales-panel" aria-labelledby="sales-plan-heading">
        <div className="sales-section-heading">
          <div>
            <h2 id="sales-plan-heading">当前排产概况</h2>
            <p>仅展示当前正式计划中的订单交期，不代表插单后的评估结果。</p>
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
                正式计划 <strong>V{overview.plan_version}</strong>
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
                          {order.id} · {order.name}
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
        <section className="sales-panel" aria-labelledby="sales-form-heading">
          <h2 id="sales-form-heading">插单需求</h2>
          <p className="sales-muted">
            填写后可检查输入并预估加工时长。提交后可在下方查看已保存的待审批申请。
          </p>
          <form onSubmit={checkDraft} noValidate>
            <fieldset disabled={!overview || loading || !!loadError || checking || submitting}>
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
              <button type="submit" className="primary">
                {checking ? '正在预估…' : '检查填写并预估加工时长'}
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
                <p>填写检查通过，尚未试排。</p>
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
              提交保存申请后，在下方待审批列表展开“查看需求”，点击“评估插单”。每条申请的结果独立保存。
            </p>
          </section>
          <section className="sales-panel" aria-labelledby="sales-status-heading">
            <h2 id="sales-status-heading">申请状态</h2>
            <p className="sales-muted">
              提交后保存为待审批；试排完成后由领导决定，批准后由排产计划员复核发布。下方保留所有申请状态与历史。
            </p>
            <button
              onClick={submit}
              disabled={!estimate || submitting || !!submitted || loading || !!loadError}
            >
              {submitting ? '正在提交…' : '提交领导审批'}
            </button>
            {submitError && <p role="alert">{submitError}</p>}
            {submitted && <p role="status">申请 {submitted} 已保存，待审批。</p>}
            <PendingRequestsPanel
              refreshVersion={requestsVersion}
              onSelection={setSelectedAssessment}
            />
          </section>
        </aside>
      </div>
    </main>
  );
}
