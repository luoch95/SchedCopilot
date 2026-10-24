import type { Candidate, Schedule, WorkflowResult } from '../api/contracts';

export type CandidateKind = 'waiting' | 'transfer' | 'manual' | 'unknown';

/** IDs and typed workflow strategies own identity; display titles never control behavior. */
export function candidateKind(
  candidate: Candidate,
  ...workflows: (WorkflowResult | null | undefined)[]
): CandidateKind {
  if (candidate.id.startsWith('manual:')) return 'manual';
  const strategy = workflows
    .flatMap((workflow) => workflow?.results.scheduling?.data?.candidates ?? [])
    .find((item) => item.candidate_id === candidate.id)?.strategy_id;
  if (strategy === 'wait-recovery') return 'waiting';
  if (strategy === 'allow-transfer') return 'transfer';
  // Historical demo IDs are stable protocol identifiers, independent of their titles.
  if (['wait', 'wait-recovery'].includes(candidate.id)) return 'waiting';
  if (['transfer', 'allow-transfer'].includes(candidate.id)) return 'transfer';
  return 'unknown';
}

export function candidateTitle(
  candidate: Candidate,
  ...workflows: (WorkflowResult | null | undefined)[]
) {
  const kind = candidateKind(candidate, ...workflows);
  return kind === 'waiting'
    ? 'AI 原线等待方案'
    : kind === 'transfer'
      ? 'AI 允许转移方案'
      : kind === 'manual'
        ? '人工调整方案'
        : candidate.label;
}

export function changedOperationCount(before: Schedule, after: Schedule) {
  const originals = new Map(before.operations.map((op) => [op.id, op]));
  return after.operations.filter((op) => {
    const original = originals.get(op.id);
    return (
      !original ||
      original.machine_id !== op.machine_id ||
      Date.parse(original.start) !== Date.parse(op.start) ||
      Date.parse(original.end) !== Date.parse(op.end)
    );
  }).length;
}
