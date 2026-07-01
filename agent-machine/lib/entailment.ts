/**
 * entailment.ts — NLI-style entailment/contradiction gate over fact pairs.
 *
 * Two tiers:
 *   1. Synchronous (classifyEntailment): deterministic, model-free; uses an injected similarity
 *      function (default: token Jaccard). Catches lexical overlap + polarity flip.
 *   2. Semantic async (classifyEntailmentSemantic): upgrades the similarity to cosine distance
 *      over embeddings from the noetica-embed sidecar. Catches paraphrase cases Jaccard misses —
 *      the key gap vs Vectara HHEM. Degrades to Jaccard if the embedder is unavailable.
 */
export type Entailment = 'entail' | 'contradict' | 'neutral'

const NEG = /\b(not|no|never|cannot|can't|won't|doesn't|isn't|aren't|n't|without|none|fails? to|un|non)\b/i

function polarity(text: string): number {
  const matches = text.match(new RegExp(NEG, 'gi')) ?? []
  return matches.length % 2 === 0 ? 1 : -1   // even negations cancel
}

/** Token Jaccard as the default similarity (replace with embedding cosine via the sim arg). */
export function jaccard(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))
  const tb = new Set(b.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]! }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

export function classifyEntailment(
  premise: string, hypothesis: string,
  sim: (a: string, b: string) => number = jaccard,
  opts: { threshold?: number } = {},
): { relation: Entailment; similarity: number } {
  const threshold = opts.threshold ?? 0.4
  const s = sim(premise, hypothesis)
  if (s < threshold) return { relation: 'neutral', similarity: s }
  const samePolarity = polarity(premise) === polarity(hypothesis)
  return { relation: samePolarity ? 'entail' : 'contradict', similarity: s }
}

/**
 * Semantic entailment: uses embedding cosine similarity from noetica-embed (fastembed/ONNX)
 * instead of token Jaccard. Catches paraphrase, reformulation, and synonym cases.
 * Falls back to Jaccard if the sidecar is unavailable (NOETICA_EMBED_FALLBACK=true callers).
 */
export async function classifyEntailmentSemantic(
  premise: string, hypothesis: string,
  opts: { threshold?: number } = {},
): Promise<{ relation: Entailment; similarity: number; method: 'semantic' | 'lexical' }> {
  const threshold = opts.threshold ?? 0.5
  try {
    const { embedBatchLocal } = await import('./embed-runtime.js')
    const vecs = await embedBatchLocal([premise, hypothesis])
    if (vecs && vecs[0] && vecs[1]) {
      const s = cosine(vecs[0], vecs[1])
      if (s < threshold) return { relation: 'neutral', similarity: s, method: 'semantic' }
      const samePolarity = polarity(premise) === polarity(hypothesis)
      return { relation: samePolarity ? 'entail' : 'contradict', similarity: s, method: 'semantic' }
    }
  } catch { /* embedder unavailable — fall through to Jaccard */ }
  const fallback = classifyEntailment(premise, hypothesis, jaccard, { threshold: opts.threshold ?? 0.4 })
  return { ...fallback, method: 'lexical' }
}

/**
 * Batch semantic entailment: one embedding pass for all (premise, hypothesis) pairs.
 * Returns null if the embedder is unavailable (caller should fall back to synchronous variant).
 */
export async function batchClassifyEntailmentSemantic(
  pairs: { premise: string; hypothesis: string }[],
  opts: { threshold?: number } = {},
): Promise<Array<{ relation: Entailment; similarity: number; method: 'semantic' | 'lexical' }> | null> {
  if (pairs.length === 0) return []
  const threshold = opts.threshold ?? 0.5
  try {
    const { embedBatchLocal } = await import('./embed-runtime.js')
    const texts = pairs.flatMap((p) => [p.premise, p.hypothesis])
    const vecs = await embedBatchLocal(texts)
    if (!vecs) return null
    return pairs.map((p, i) => {
      const va = vecs[i * 2], vb = vecs[i * 2 + 1]
      if (!va || !vb) return { ...classifyEntailment(p.premise, p.hypothesis, jaccard, { threshold: opts.threshold ?? 0.4 }), method: 'lexical' as const }
      const s = cosine(va, vb)
      if (s < threshold) return { relation: 'neutral' as Entailment, similarity: s, method: 'semantic' as const }
      const samePolarity = polarity(p.premise) === polarity(p.hypothesis)
      return { relation: (samePolarity ? 'entail' : 'contradict') as Entailment, similarity: s, method: 'semantic' as const }
    })
  } catch { return null }
}
