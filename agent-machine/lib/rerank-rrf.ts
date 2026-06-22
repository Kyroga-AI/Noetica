/**
 * rerank-rrf.ts — Reciprocal Rank Fusion: combine multiple rankers (lexical, dense, structural, late-
 * interaction) into one ranking without tuning weights. RRF is robust because it uses only RANK position,
 * so no single scorer's scale dominates. score(d) = Σ 1/(k + rank_i(d)).
 */
export function reciprocalRankFusion(rankings: string[][], k = 60): Array<{ id: string; score: number }> {
  const acc = new Map<string, number>()
  for (const ranking of rankings) {
    ranking.forEach((id, i) => acc.set(id, (acc.get(id) ?? 0) + 1 / (k + i + 1)))
  }
  return [...acc.entries()]
    .map(([id, score]) => ({ id, score: Number(score.toFixed(6)) }))
    .sort((a, b) => b.score - a.score)
}
