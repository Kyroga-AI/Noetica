/**
 * late-interaction.ts — ColBERT-style late-interaction (MaxSim) reranking. Single-vector dense retrieval
 * pools a passage into one vector, blurring term-level matches; late interaction keeps PER-TOKEN vectors and
 * scores by summing, for each query token, its best match against any doc token — markedly better on the
 * entity/phrase-heavy queries typical of KG-QA. Upgrades the retrieval primitive under everything else.
 */
function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]! }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/** MaxSim: sum over query tokens of the max cosine to any doc token. */
export function maxSim(queryVecs: number[][], docVecs: number[][]): number {
  if (queryVecs.length === 0 || docVecs.length === 0) return 0
  let total = 0
  for (const q of queryVecs) {
    let best = -Infinity
    for (const d of docVecs) { const s = cosine(q, d); if (s > best) best = s }
    total += best
  }
  return total / queryVecs.length    // normalize by query length
}

export function rerankLate(queryVecs: number[][], docs: Array<{ id: string; vecs: number[][] }>, topK = 10): Array<{ id: string; score: number }> {
  return docs
    .map((d) => ({ id: d.id, score: Number(maxSim(queryVecs, d.vecs).toFixed(5)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
