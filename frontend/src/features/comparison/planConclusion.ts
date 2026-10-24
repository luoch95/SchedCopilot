import type { Candidate, WorkflowResult } from '../../shared/api/contracts';
import { candidateKind } from '../../shared/lib/candidatePresentation';

/** Compare simulated candidates; the unaffected formal plan is not a failure scenario. */
export function planConclusion(candidates: Candidate[], workflow: WorkflowResult | null) {
  const valid = candidates.filter(
    (candidate) =>
      Number.isFinite(candidate.metrics.total_lateness_minutes) &&
      Number.isFinite(Date.parse(candidate.metrics.makespan)),
  );
  const ranked = [...valid].sort(
    (a, b) =>
      a.metrics.total_lateness_minutes - b.metrics.total_lateness_minutes ||
      Date.parse(a.metrics.makespan) - Date.parse(b.metrics.makespan),
  );
  const best = ranked[0];
  if (!best)
    return {
      headline: '候选方案已生成，请核对指标后选择。',
      context: '指标尚不完整，请查看依据与风险。',
      improved: false,
    };
  const referenceId = workflow?.results.scheduling?.data?.candidates?.find(
    (item) => item.strategy_id === 'wait-recovery',
  )?.candidate_id;
  const reference = referenceId
    ? valid.find((item) => item.id === referenceId)
    : valid.find((item) => candidateKind(item, workflow) === 'waiting');
  const earlier = reference
    ? (Date.parse(reference.metrics.makespan) - Date.parse(best.metrics.makespan)) / 60_000
    : 0;
  const lessDelay = reference
    ? reference.metrics.total_lateness_minutes - best.metrics.total_lateness_minutes
    : 0;
  const format = (value: number) => Number(value.toFixed(1));
  if (reference && best.id !== reference.id && (earlier > 0 || lessDelay > 0)) {
    const gains = [
      earlier > 0 ? `预计整体提前 ${format(earlier)} 分钟完工` : '',
      lessDelay > 0 ? `累计延期减少 ${format(lessDelay)} 分钟` : '',
    ]
      .filter(Boolean)
      .join('，');
    return {
      headline: `建议优先采用【${best.label}】：${gains}。`,
      context: `相较【${reference.label}】；发布前请核对现场条件与资源约束。`,
      improved: true,
    };
  }
  return {
    headline: `优先审核【${best.label}】：累计延期 ${format(best.metrics.total_lateness_minutes)} 分钟。`,
    context:
      ranked.length > 1
        ? '按累计延期、整体完工时间比较；请结合设备约束确认。'
        : '当前仅有一套可比较方案，请核对现场条件后确认。',
    improved: false,
  };
}
