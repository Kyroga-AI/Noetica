/**
 * vector-index.ts — in-store-adjacent vector index keyed by node id (the #1 graph-DB gap: SOTA stores —
 * Neo4j 5 / KuzuDB / Memgraph — ship a native HNSW index + graph-vector hybrid query; HellGraph has none).
 * This is the Noetica-layer shim over noetica-embed vectors: exact cosine kNN (correct + simple), plus a
 * graph-vector HYBRID query — vector kNN entry points, then expand along graph adjacency. The upgrade path is
 * a native HNSW (usearch/hnsw_rs) inside the HellGraph Rust core; this delivers the capability today.
 */
export interface IndexedVector { id: string; vec: Float32Array | number[] }

function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0, na = 0, nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const ai = a[i]!, bi = b[i]!
    if (!Number.isFinite(ai) || !Number.isFinite(bi)) return 0   // a NaN/Infinity element (injectable via JSON) ⇒ 0, never NaN scores
    dot += ai * bi; na += ai * ai; nb += bi * bi
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

export class VectorIndex {
  private items: IndexedVector[] = []
  private ids = new Set<string>()

  add(id: string, vec: Float32Array | number[]): void {
    if (this.ids.has(id)) { const i = this.items.findIndex((x) => x.id === id); this.items[i] = { id, vec } }
    else { this.items.push({ id, vec }); this.ids.add(id) }
  }
  addMany(items: IndexedVector[]): void { for (const it of items) this.add(it.id, it.vec) }
  size(): number { return this.items.length }
  has(id: string): boolean { return this.ids.has(id) }

  /** Exact cosine top-k (excludes the query id if present). */
  search(query: Float32Array | number[], k = 10, excludeId?: string): Array<{ id: string; score: number }> {
    return this.items
      .filter((it) => it.id !== excludeId)
      .map((it) => ({ id: it.id, score: Number(cosine(query, it.vec).toFixed(5)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
  }
}

/**
 * Graph-vector HYBRID query (the SOTA one-query GraphRAG move): kNN to find vector entry points, then expand
 * along graph adjacency up to `hops`, returning entry nodes + their graph neighbourhood with the hop distance.
 */
export function hybridGraphVector(
  query: Float32Array | number[],
  index: VectorIndex,
  adj: Map<string, string[]>,
  opts: { k?: number; hops?: number } = {},
): Array<{ id: string; score: number; hop: number }> {
  const k = opts.k ?? 5, hops = opts.hops ?? 1
  const seeds = index.search(query, k)
  const seen = new Map<string, { score: number; hop: number }>()
  for (const s of seeds) seen.set(s.id, { score: s.score, hop: 0 })
  let frontier = seeds.map((s) => s.id)
  for (let h = 1; h <= hops; h++) {
    const next: string[] = []
    for (const id of frontier) for (const nb of adj.get(id) ?? []) {
      if (!seen.has(nb)) { seen.set(nb, { score: 0, hop: h }); next.push(nb) }
    }
    frontier = next
  }
  return [...seen.entries()].map(([id, v]) => ({ id, score: v.score, hop: v.hop })).sort((a, b) => a.hop - b.hop || b.score - a.score)
}
