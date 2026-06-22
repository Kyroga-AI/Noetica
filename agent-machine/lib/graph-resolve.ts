/**
 * graph-resolve.ts — entity resolution (Senzing/Quantexa/Stardog territory, fused with our embeddings).
 *
 * Hygiene removes exact-duplicate labels; entity resolution is harder — it links records that refer to
 * the SAME real-world entity despite different spellings, abbreviations, or phrasings ("model-router" /
 * "model router" / "the router"). We fuse two signals we already have: normalized edit similarity
 * (surface form) and entity-embedding cosine (meaning), plus a substring/abbreviation check. The output
 * is ranked merge candidates with evidence + confidence — proposals, not silent merges, so a human (or
 * the verifier) confirms. This is the dedupe layer GraphRAG and the memory engines lack.
 */

import { cosineSim } from './graph-search.js'

export interface MergeCandidate {
  a: string; b: string       // labels
  aId: string; bId: string
  stringSim: number          // 0..1 normalized edit similarity
  semanticSim: number        // 0..1 entity-embedding cosine (0 if not embedded)
  confidence: number         // blended
  reason: string
}

/** Normalized Levenshtein similarity (1 = identical). Linear-memory DP. */
function editSim(a: string, b: string): number {
  a = a.toLowerCase(); b = b.toLowerCase()
  if (a === b) return 1
  const m = a.length, n = b.length
  if (!m || !n) return 0
  const dp = Array.from({ length: m + 1 }, (_, i) => i)
  for (let j = 1; j <= n; j++) {
    let prev = dp[0]!; dp[0] = j
    for (let i = 1; i <= m; i++) { const tmp = dp[i]!; dp[i] = Math.min(dp[i]! + 1, dp[i - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp }
  }
  return 1 - dp[m]! / Math.max(m, n)
}

/** Rank merge candidates among entities by fusing surface-form + semantic similarity. */
export function resolveEntities(entities: Array<{ id: string; label: string }>, vectors: Map<string, number[]>, opts: { minConfidence?: number; topK?: number } = {}): MergeCandidate[] {
  const min = opts.minConfidence ?? 0.85
  const out: MergeCandidate[] = []
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const A = entities[i]!, B = entities[j]!
      if (A.label === B.label || !A.label || !B.label) continue
      const ss = editSim(A.label, B.label)
      const va = vectors.get(A.id), vb = vectors.get(B.id)
      const sem = va && vb ? cosineSim(va, vb) : 0
      const al = A.label.toLowerCase(), bl = B.label.toLowerCase()
      const sub = al !== bl && (al.includes(bl) || bl.includes(al)) && Math.min(al.length, bl.length) >= 3

      let confidence = 0, reason = ''
      if (ss >= 0.85) { confidence = ss; reason = 'near-identical labels' }
      else if (sem >= 0.92) { confidence = sem; reason = 'near-identical meaning' }
      else if (sub && sem >= 0.75) { confidence = (sem + 0.85) / 2; reason = 'abbreviation/substring + similar meaning' }
      else if (ss >= 0.7 && sem >= 0.8) { confidence = (ss + sem) / 2; reason = 'similar label + meaning' }

      if (confidence >= min) out.push({ a: A.label, b: B.label, aId: A.id, bId: B.id, stringSim: Number(ss.toFixed(2)), semanticSim: Number(sem.toFixed(2)), confidence: Number(confidence.toFixed(2)), reason })
    }
  }
  return out.sort((x, y) => y.confidence - x.confidence).slice(0, opts.topK ?? 30)
}
