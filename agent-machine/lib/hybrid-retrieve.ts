/**
 * hybrid-retrieve.ts — BM25 lexical scoring + fusion with dense retrieval. Beyond a quality win, the hybrid
 * is a POISONING DEFENSE: gradient-optimized poison triggers fool dense embeddings but not lexical BM25, so
 * fusing them blunts PoisonedRAG-style attacks (a free win given we already run the embedder).
 */
import { reciprocalRankFusion } from './rerank-rrf.js'

const tokenize = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1)

export interface Doc { id: string; text: string }

/** BM25 ranking of docs for a query. */
export function bm25(query: string, docs: Doc[], opts: { k1?: number; b?: number } = {}): Array<{ id: string; score: number }> {
  const k1 = opts.k1 ?? 1.5, b = opts.b ?? 0.75
  const N = docs.length || 1
  const docToks = docs.map((d) => tokenize(d.text))
  const avgLen = docToks.reduce((s, t) => s + t.length, 0) / N || 1
  const df = new Map<string, number>()
  for (const toks of docToks) for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1)
  const qToks = [...new Set(tokenize(query))]
  return docs.map((d, i) => {
    const toks = docToks[i]!
    const len = toks.length || 1
    const tf = new Map<string, number>()
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1)
    let score = 0
    for (const q of qToks) {
      const f = tf.get(q) ?? 0
      if (f === 0) continue
      const idf = Math.log(1 + (N - (df.get(q) ?? 0) + 0.5) / ((df.get(q) ?? 0) + 0.5))
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (len / avgLen)))
    }
    return { id: d.id, score: Number(score.toFixed(5)) }
  }).sort((a, b2) => b2.score - a.score)
}

/** Fuse lexical (BM25) and dense (caller-ranked ids) via RRF. */
export function fuseHybrid(query: string, docs: Doc[], denseRankedIds: string[], k = 60): Array<{ id: string; score: number }> {
  const lexical = bm25(query, docs).map((r) => r.id)
  return reciprocalRankFusion([lexical, denseRankedIds], k)
}
