import type { Candidate, Simulation, Workbench } from '../../shared/api/contracts';
import { WriteButton } from '../../shared/ui/WriteButton';
import { useDemoAccess } from '../../shared/lib/demoAccess';
interface Props {
  state: Workbench;
  currentSimulation: Simulation;
  candidate: Candidate | undefined;
  busy: string;
  blocked: boolean;
  selected: string;
  reason: string;
  action: string;
  onSelected: (value: string) => void;
  onReason: (value: string) => void;
  onAction: (value: string) => void;
  onDecide: () => void;
  onSubmitReview: () => void;
}
export function DecisionPanel({
  state,
  currentSimulation,
  candidate,
  busy,
  blocked,
  selected,
  reason,
  action,
  onSelected,
  onReason,
  onAction,
  onDecide,
  onSubmitReview,
}: Props) {
  const { readOnly } = useDemoAccess();
  const review = state.fault_review;
  const matches =
    review?.simulation_id === currentSimulation.id && review?.candidate_id === selected;
  const approved = matches && review?.status === 'approved';
  const pending = matches && review?.status === 'pending';
  return (
    <section id="fault-confirm" tabIndex={-1} className="section decision-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">HUMAN IN THE LOOP</p>
          <h2 id="section-confirm">人工确认</h2>
        </div>
        <span className="tag">当前执行计划 V{state.baseline.version}</span>
      </div>
      <h3 id="section-input" className="block-title">
        决策输入
      </h3>
      <fieldset disabled={!!busy}>
        <div className="decision-fields">
          <label>
            本次处理的方案
            <select value={selected} onChange={(e) => onSelected(e.target.value)}>
              {currentSimulation.candidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            处理方式
            <select disabled={readOnly} value={action} onChange={(e) => onAction(e.target.value)}>
              <option value="reject">暂不发布</option>
              <option value="publish">{approved ? '正式发布' : '提交管理者审批'}</option>
            </select>
          </label>
        </div>
        <label>
          确认理由（必填）
          <textarea
            maxLength={2000}
            disabled={readOnly}
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            placeholder="说明选择理由以及接受的代价"
          />
        </label>
        {action === 'publish' && candidate?.metrics.moved_operations === 0 && (
          <p className="hint">该方案与当前计划相同，无需重复发布。</p>
        )}
        <div className="decision-feedback">
          <p className="hint">
            {action === 'publish'
              ? approved
                ? `管理者已批准“${candidate?.label}”，可发布为 V${state.baseline.version + 1}。`
                : pending
                  ? '方案已提交，等待管理者审批。修改方案后需重新提交。'
                  : '方案需经管理者审批，批准后才能发布。'
              : '只记录人工决定，执行计划保持不变。'}
          </p>
        </div>
        {review && (
          <p className="hint">
            管理者审批（{review.candidate_label}）：
            {review.status === 'approved'
              ? '已批准'
              : review.status === 'pending'
                ? '待审批'
                : review.status === 'rejected'
                  ? '已退回'
                  : '已更新'}
            {!matches && ' · 当前选择已变更，需重新审批'}
            {review.review_reason && ` · ${review.review_reason}`}
          </p>
        )}
        <div className="decision-actions">
          <WriteButton
            disabled={!reason.trim() || blocked || action !== 'reject'}
            onClick={onDecide}
          >
            记录暂不发布
          </WriteButton>
          <WriteButton
            className="primary decision-publish"
            disabled={
              !reason.trim() ||
              blocked ||
              pending ||
              action !== 'publish' ||
              !candidate ||
              candidate.metrics.moved_operations === 0
            }
            onClick={approved ? onDecide : onSubmitReview}
          >
            {approved
              ? '确认发布执行计划'
              : pending
                ? '等待管理者审批'
                : review
                  ? '修改后重新提交审批'
                  : '提交管理者审批'}
          </WriteButton>
        </div>
      </fieldset>
    </section>
  );
}
