/**
 * graph-struct.ts — structural (DeepWalk/node2vec-style) node embeddings.
 *
 * We already have TEXT entity embeddings (similar meaning) and Adamic-Adar (shared neighbours). This adds
 * the third axis the mature graph-ML stacks (Neo4j GDS) have: STRUCTURAL embeddings from random walks —
 * nodes that occupy similar *positions* in the topology get similar vectors, even if their labels differ
 * and they share no direct neighbours (e.g. two "router"-like hubs in different subgraphs). DeepWalk's
 * first-order signal without skip-gram training: random walks → windowed co-occurrence vectors → cosine.
 */

function l2norm(v: Float64Array): Float64Array {
  let s = 0; for (const x of v) s += x * x
  const n = Math.sqrt(s) || 1
  const out = new Float64Array(v.length); for (let i = 0; i < v.length; i++) out[i] = v[i]! / n
  return out
}
function cosine(a: Float64Array, b: Float64Array): number { let d = 0; for (let i = 0; i < a.length; i++) d += a[i]! * b[i]!; return d }

export interface StructuralEmbeddings { ids: string[]; index: Map<string, number>; vectors: Map<string, Float64Array> }

/** Random-walk co-occurrence embeddings. Each node → an L2-normalized vector over the node space. */
export function structuralEmbeddings(
  nodes: Array<{ id: string }>,
  edges: Array<{ from: string; to: string }>,
  opts: { walks?: number; length?: number; window?: number } = {},
): StructuralEmbeddings {
  const walks = opts.walks ?? 10, length = opts.length ?? 8, window = opts.window ?? 2
  const ids: string[] = []
  const index = new Map<string, number>()
  for (const n of nodes) if (!index.has(n.id)) { index.set(n.id, ids.length); ids.push(n.id) }
  const adj: number[][] = ids.map(() => [])
  for (const e of edges) { const a = index.get(e.from), b = index.get(e.to); if (a !== undefined && b !== undefined && a !== b) { adj[a]!.push(b); adj[b]!.push(a) } }

  const cooc = ids.map(() => new Float64Array(ids.length))
  for (let s = 0; s < ids.length; s++) {
    if (adj[s]!.length === 0) continue
    for (let w = 0; w < walks; w++) {
      const path: number[] = [s]
      let cur = s
      for (let step = 0; step < length; step++) {
        const nbrs = adj[cur]!
        if (nbrs.length === 0) break
        cur = nbrs[Math.floor(Math.random() * nbrs.length)]!
        path.push(cur)
      }
      for (let p = 0; p < path.length; p++) {
        for (let q = Math.max(0, p - window); q <= Math.min(path.length - 1, p + window); q++) {
          if (p === q) continue
          cooc[path[p]!]![path[q]!] += 1
        }
      }
    }
  }
  const vectors = new Map<string, Float64Array>()
  for (let i = 0; i < ids.length; i++) vectors.set(ids[i]!, l2norm(cooc[i]!))
  return { ids, index, vectors }
}

/** Top-k structurally similar nodes (similar topological role) to the target. */
export function structurallySimilar(targetId: string, emb: StructuralEmbeddings, k = 8): Array<{ id: string; sim: number }> {
  const tv = emb.vectors.get(targetId)
  if (!tv) return []
  const out: Array<{ id: string; sim: number }> = []
  for (const [id, v] of emb.vectors) { if (id === targetId) continue; const s = cosine(tv, v); if (s > 0) out.push({ id, sim: Number(s.toFixed(3)) }) }
  return out.sort((a, b) => b.sim - a.sim).slice(0, k)
}
