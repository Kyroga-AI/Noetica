/**
 * judge.ts — bias-mitigated LLM-as-judge aggregation for the subjective dimensions the deterministic verifier
 * can't score (helpfulness, tone, completeness). Neutralizes documented judge biases: PAIRWISE comparison,
 * POSITION-SWAP (only count a win that survives swapping the order), and a JURY of small models (PoLL) to cut
 * self-enhancement bias. The actual model calls are the caller's; this is the aggregation logic.
 */
export type Side = 'a' | 'b' | 'tie'

/** A win counts only if it survives swapping the candidate order; otherwise it's position bias → tie. */
export function swapRobustWinner(forward: Side, swapped: Side): Side {
  // `swapped` was judged with a/b flipped, so flip it back to compare on the same frame
  const unflipped: Side = swapped === 'a' ? 'b' : swapped === 'b' ? 'a' : 'tie'
  return forward === unflipped ? forward : 'tie'
}

/** Majority vote of a jury of judges, with agreement fraction (PoLL). Ties broken to 'tie'. */
export function juryVote(verdicts: Side[]): { winner: Side; agreement: number } {
  if (verdicts.length === 0) return { winner: 'tie', agreement: 0 }
  const counts: Record<Side, number> = { a: 0, b: 0, tie: 0 }
  // Allowlist the key before indexing — writing a user/model-derived key into an
  // object is js/remote-property-injection; an equality allowlist clears it and
  // ignores any out-of-domain verdict (behavior-preserving for valid Side input).
  for (const v of verdicts) if (v === 'a' || v === 'b' || v === 'tie') counts[v]++
  const winner: Side = counts.a > counts.b && counts.a >= counts.tie ? 'a' : counts.b > counts.a && counts.b >= counts.tie ? 'b' : 'tie'
  return { winner, agreement: counts[winner] / verdicts.length }
}
