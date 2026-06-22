/**
 * graph-ppr.ts — Personalized (query-seeded) PageRank, the HippoRAG insight.
 *
 * Plain PageRank (graph-analytics.ts) teleports UNIFORMLY → a static global importance prior. Personalized
 * PageRank teleports to a SEED SET (the entities named in the query) → a single diffusion does associative,
 * multi-hop retrieval in one shot (hippocampal pattern completion), no iterative LLM-in-the-loop. Same engine,
 * query-conditioned. Inference-only, local-native. Ref: HippoRAG / "From RAG to Memory" (arXiv 2502.14802).
 */

export interface PPRNode { id: string }
export interface PPREdge { from: string; to: string }

/** Personalized PageRank: power iteration with teleport concentrated on `seedIds` (undirected adjacency). */
export function personalizedPageRank(
  nodes: PPRNode[], edges: PPREdge[], seedIds: string[],
  { damping = 0.85, iterations = 60, tolerance = 1e-6 }: { damping?: number; iterations?: number; tolerance?: number } = {},
): Map<string, number> {
  const ids = nodes.map((n) => n.id)
  const n = ids.length
  const out = new Map<string, number>()
  if (n === 0) return out
  const idx = new Map(ids.map((id, i) => [id, i]))
  const adj: number[][] = Array.from({ length: n }, () => [])
  for (const e of edges) {
    const a = idx.get(e.from), b = idx.get(e.to)
    if (a == null || b == null || a === b) continue
    adj[a]!.push(b); adj[b]!.push(a)   // undirected
  }
  const deg = adj.map((a) => a.length)
  // teleport vector s: mass on the seeds (uniform fallback if no seed resolved)
  const seedIdx = seedIds.map((s) => idx.get(s)).filter((x): x is number => x != null)
  const s = new Float64Array(n)
  if (seedIdx.length) { const w = 1 / seedIdx.length; for (const i of seedIdx) s[i]! += w }
  else s.fill(1 / n)
  let pr = Float64Array.from(s)
  for (let it = 0; it < iterations; it++) {
    const next = new Float64Array(n)
    let dangling = 0
    for (let i = 0; i < n; i++) if (deg[i] === 0) dangling += pr[i]!
    // teleport (1-d) and dangling mass both flow back to the seed distribution, not uniform
    for (let i = 0; i < n; i++) next[i] = (1 - damping) * s[i]! + damping * dangling * s[i]!
    for (let i = 0; i < n; i++) {
      const share = deg[i] ? (damping * pr[i]!) / deg[i]! : 0
      if (!share) continue
      for (const j of adj[i]!) next[j]! += share
    }
    let diff = 0
    for (let i = 0; i < n; i++) diff += Math.abs(next[i]! - pr[i]!)
    pr = next
    if (diff < tolerance) break
  }
  for (let i = 0; i < n; i++) out.set(ids[i]!, pr[i]!)
  return out
}

/** Resolve a query to seed node ids by matching its terms against node labels (exact > substring). */
export function seedFromQuery(query: string, labelById: Map<string, string>): string[] {
  const q = query.toLowerCase()
  const terms = q.split(/[^a-z0-9]+/).filter((t) => t.length >= 3)
  const exact: string[] = []; const partial: string[] = []
  for (const [id, label] of labelById) {
    const l = label.toLowerCase()
    if (!l) continue
    if (q.includes(l)) exact.push(id)                                  // the whole label appears in the query
    else if (terms.some((t) => l.includes(t) || t.includes(l))) partial.push(id)
  }
  return (exact.length ? exact : partial).slice(0, 12)
}

/** Top-k associatively-related nodes for a query (the HippoRAG retrieval surface). Seeds excluded by default. */
export function associativeRetrieve(
  nodes: PPRNode[], edges: PPREdge[], labelById: Map<string, string>, query: string,
  { topK = 10, includeSeeds = false }: { topK?: number; includeSeeds?: boolean } = {},
): { seeds: string[]; results: Array<{ id: string; label: string; score: number }> } {
  const seeds = seedFromQuery(query, labelById)
  const ranks = personalizedPageRank(nodes, edges, seeds)
  const seedSet = new Set(seeds)
  const results = [...ranks.entries()]
    .filter(([id]) => includeSeeds || !seedSet.has(id))
    .map(([id, score]) => ({ id, label: labelById.get(id) ?? id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
  return { seeds, results }
}
