/**
 * graph-embed.ts — entity embeddings (GraphRAG's "embed entities" stage).
 *
 * Structural signals (Adamic-Adar, common neighbours) find links from TOPOLOGY. Entity embeddings add
 * the SEMANTIC axis: two concepts can be related by meaning even with no shared neighbours yet. We embed
 * each entity with our own local embedder (noetica-embed — sovereign, no vendor), which powers (a)
 * "similar entities" for richer local search and (b) semantic link prediction that complements the
 * structural predictor. Same verifier still gates every suggested link.
 */

import { embedBatchLocal } from './embed-runtime.js'
import { cosineSim } from './graph-search.js'
import type { LinkPrediction } from './graph-predict.js'

/** Embed entities by their text (label + optional context). Returns id → vector (only those embedded). */
export async function embedEntities(entities: Array<{ id: string; text: string }>): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>()
  if (entities.length === 0) return out
  let vecs: (number[] | null)[] | null = null
  try { vecs = await embedBatchLocal(entities.map((e) => e.text)) } catch { return out }   // embedder cold → no semantics
  if (!vecs) return out
  entities.forEach((e, i) => { const v = vecs![i]; if (v) out.set(e.id, v) })
  return out
}

/** Top-k entities most semantically similar to the target (cosine over entity vectors). */
export function similarEntities(targetId: string, vectors: Map<string, number[]>, k = 8): Array<{ id: string; sim: number }> {
  const tv = vectors.get(targetId)
  if (!tv) return []
  const out: Array<{ id: string; sim: number }> = []
  for (const [id, v] of vectors) { if (id === targetId) continue; out.push({ id, sim: cosineSim(tv, v) }) }
  return out.sort((a, b) => b.sim - a.sim).slice(0, k)
}

/** Semantic link prediction: cosine-similar entity pairs that are NOT already connected → candidates. */
export function semanticPredict(
  vectors: Map<string, number[]>,
  edges: Array<{ from: string; to: string }>,
  opts: { topK?: number; minSim?: number } = {},
): Array<{ source: string; target: string; sim: number }> {
  const linked = new Set<string>()
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  for (const e of edges) linked.add(key(e.from, e.to))
  const ids = [...vectors.keys()]
  const minSim = opts.minSim ?? 0.6
  const pairs: Array<{ source: string; target: string; sim: number }> = []
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]!, b = ids[j]!
      if (linked.has(key(a, b))) continue
      const sim = cosineSim(vectors.get(a)!, vectors.get(b)!)
      if (sim >= minSim) pairs.push({ source: a, target: b, sim: Number(sim.toFixed(3)) })
    }
  }
  return pairs.sort((x, y) => y.sim - x.sim).slice(0, opts.topK ?? 20)
}

/** Blend structural predictions with the semantic axis: annotate each with cosine sim, add semantic-
 *  only candidates, and re-rank by 0.6·structural + 0.4·semantic. The verifier still gates the result. */
export function blendSemantic(
  structural: LinkPrediction[],
  vectors: Map<string, number[]>,
  edges: Array<{ from: string; to: string }>,
  topK: number,
): LinkPrediction[] {
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const present = new Set(structural.map((p) => key(p.source, p.target)))
  for (const p of structural) { const a = vectors.get(p.source), b = vectors.get(p.target); if (a && b) p.sim = Number(cosineSim(a, b).toFixed(3)) }
  for (const sp of semanticPredict(vectors, edges, { topK, minSim: 0.65 })) {
    const k = key(sp.source, sp.target)
    if (!present.has(k)) { structural.push({ source: sp.source, target: sp.target, score: 0, sim: sp.sim, commonNeighbors: 0 }); present.add(k) }
  }
  const blend = (p: LinkPrediction) => (p.score || 0) * 0.6 + (p.sim || 0) * 0.4
  return structural.sort((a, b) => blend(b) - blend(a)).slice(0, topK)
}
