import type { WorkflowResult } from '../api/contracts';
import { productionConditionLimitation } from '../lib/productionConditions';

/** Display-only aggregate of server-validated rule scores. Never authorizes an action. */
export function workflowTrust(result: WorkflowResult | null): number | null {
  if (result?.status !== 'completed') return null;
  const validation = result.results.validation;
  const gate = validation?.quality?.score;
  if (
    gate == null ||
    !Number.isFinite(gate) ||
    gate < 98 ||
    gate > 100 ||
    !['success', 'warning'].includes(validation!.status)
  )
    return null;
  const scores = (['scheduling', 'evaluation', 'explanation'] as const).map(
    (role) => result.results[role]?.quality?.score,
  );
  if (scores.some((score) => score == null || !Number.isFinite(score) || score < 0 || score > 100))
    return null;
  return scores.reduce<number>((sum, score) => sum + score!, 0) / 3;
}

export function TrustScore({ result }: { result: WorkflowResult | null }) {
  const validation = result?.results.validation;
  const data = validation?.data;
  const unchecked = Array.isArray(data?.unchecked_items)
    ? [...new Set(data.unchecked_items.filter((item): item is string => typeof item === 'string'))]
    : null;
  const issues = Array.isArray(data?.issues) ? data.issues : null;
  const passed =
    result?.status === 'completed' &&
    !!validation &&
    ['success', 'warning'].includes(validation.status) &&
    data?.can_generate_candidates === true &&
    Array.isArray(data.checked_items) &&
    data.checked_items.length > 0 &&
    unchecked !== null &&
    issues !== null &&
    !['blocked', 'failed'].includes(validation.quality?.outcome ?? '') &&
    validation.errors.length === 0 &&
    !issues.some((item) => item.severity === 'blocking');
  const validList = (items: unknown): items is string[] =>
    Array.isArray(items) &&
    items.every((item) => typeof item === 'string' && item.trim().length > 0);
  const complete = validList(data?.checked_items) && validList(data?.unchecked_items);
  const checked = complete
    ? [...new Set(data!.checked_items!)].filter((item) => !unchecked!.includes(item))
    : [];
  const count = checked.length + (unchecked?.length ?? 0);
  const percent =
    passed && complete && count > 0 ? Math.round((checked.length / count) * 100) : null;
  return (
    <details
      className="workflow-trust"
      title={
        passed
          ? unchecked.map(productionConditionLimitation).join('\n')
          : '以数据校验记录为准；技术评分见 Agent 链路。'
      }
    >
      <summary>
        <strong>评估可信度：{percent === null ? '暂无法量化' : `${percent}%`}</strong>
        {' · '}
        <span>
          {passed
            ? unchecked.length > 0
              ? `已检查约束通过，另有 ${unchecked.length} 项生产条件待核验`
              : '已检查约束通过，无待核验生产条件'
            : !data
              ? '约束校验记录不完整，暂无法确认'
              : '约束检查未通过或尚未完成，请查看具体问题'}
        </span>
      </summary>
      <p>按已登记条件的核验覆盖程度计算，不代表按期交付概率，也不影响审批与发布权限。</p>
      {percent !== null && (
        <p>
          计算口径 conditions-v1：已核验 {checked.length} 项 ÷（已核验 {checked.length} 项 ＋ 待核验{' '}
          {unchecked!.length} 项）× 100%，四舍五入到整数。待核验条件不计为通过。
        </p>
      )}
      {unchecked?.map((item) => (
        <p key={item}>{productionConditionLimitation(item)}</p>
      ))}
    </details>
  );
}
