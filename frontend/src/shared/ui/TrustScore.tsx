import type { WorkflowResult } from '../api/contracts';

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
  const score = workflowTrust(result);
  return (
    <p
      className="workflow-trust"
      title="后三个 Agent 的规则质量评分均值，不是成功概率；明细见 Agent 链路。"
    >
      综合信任度：<strong>{score === null ? '未评分' : `${score.toFixed(2)}%`}</strong>
    </p>
  );
}
