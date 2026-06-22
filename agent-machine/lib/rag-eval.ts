/**
 * rag-eval.ts — retrieval-quality metrics (RAGAS/DeepEval family). Our verifier audits the ANSWER; these
 * audit the RETRIEVER — the silent-failure mode where a confidently-grounded answer is wrong because a key
 * chunk was never fetched, or relevant chunks were buried under noise. Deterministic given relevance labels.
 */

/** Context precision: signal-to-noise of the retrieved set (fraction relevant). */
export function contextPrecision(retrieved: Array<{ relevant: boolean }>): number {
  if (retrieved.length === 0) return 0
  return retrieved.filter((r) => r.relevant).length / retrieved.length
}

/** Context recall: fraction of the reference/needed chunks that were actually retrieved. */
export function contextRecall(retrievedIds: string[], referenceIds: string[]): number {
  if (referenceIds.length === 0) return 1
  const got = new Set(retrievedIds)
  return referenceIds.filter((id) => got.has(id)).length / referenceIds.length
}

/**
 * Order-aware contextual precision (rewards relevant chunks ranked ABOVE irrelevant ones) — a re-ranker eval.
 * Average precision at the positions of relevant items.
 */
export function contextualPrecisionAtK(rankedRelevance: boolean[]): number {
  let hits = 0, sum = 0
  for (let i = 0; i < rankedRelevance.length; i++) {
    if (rankedRelevance[i]) { hits++; sum += hits / (i + 1) }
  }
  return hits === 0 ? 0 : sum / hits
}

/** Noise sensitivity proxy: share of irrelevant chunks ranked above the last relevant one. */
export function noiseLeadingRanks(rankedRelevance: boolean[]): number {
  const lastRel = rankedRelevance.lastIndexOf(true)
  if (lastRel < 0) return 0
  return rankedRelevance.slice(0, lastRel).filter((r) => !r).length
}
