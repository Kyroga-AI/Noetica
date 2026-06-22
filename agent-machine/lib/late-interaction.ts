/**
 * late-interaction.ts — ColBERT-style late-interaction (MaxSim) reranking. Single-vector dense retrieval
 * pools a passage into one vector, blurring term-level matches; late interaction keeps PER-TOKEN vectors and
 * scores by summing, for each query token, its best match against any doc token — markedly better on the
 * entity/phrase-heavy queries typical of KG-QA. Upgrades the retrieval primitive under everything else.
 */
import { cosineSim as cosine } from './vec-sim.js'

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
