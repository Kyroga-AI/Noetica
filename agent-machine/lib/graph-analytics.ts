/**
 * graph-analytics.ts — Graph Data Science over HellGraph.
 *
 * The surface ranked nodes by raw `degree` and clustered them by shared label tokens. That's
 * shallow: degree says "many edges", not "important", and token-clustering leaks junk. This module
 * adds the structural analytics the best graph platforms (Neo4j GDS, TigerGraph, Memgraph-MAGE)
 * are built on, computed locally with zero deps:
 *
 *   • PageRank          — true importance (which concepts are load-bearing), not just edge count.
 *   • Louvain           — communities from topology (real clusters), not string overlap.
 *   • Betweenness       — "bridge" concepts that connect otherwise-separate domains (Brandes).
 *
 * Everything runs on plain {id} / {from,to} arrays so it's decoupled from the graph store and the
 * surface builder. Results are keyed by node id so callers (the surface, GraphRAG) can overlay them.
 */

export interface NodeMetrics {
  id: string
  degree: number
  pagerank: number     // normalized 0..1 relative to the max in this graph
  betweenness: number  // normalized 0..1 relative to the max in this graph
  community: number    // Louvain community id (-1 = isolated)
}

export interface CommunitySummary {
  id: number
  size: number
  members: string[]    // node ids, ranked by pagerank within the community
  topNodes: string[]   // the top few members (community "representatives")
}

export interface GraphAnalytics {
  nodes: Record<string, NodeMetrics>
  communities: CommunitySummary[]
  modularity: number
  summary: {
    nodeCount: number
    edgeCount: number
    communityCount: number
    topByPagerank: Array<{ id: string; score: number }>
    topByBetweenness: Array<{ id: string; score: number }>
    betweennessApproximated: boolean
  }
}

type Edge = { from: string; to: string }
type Node = { id: string }

interface Adjacency {
  ids: string[]                 // index → node id
  index: Map<string, number>    // node id → index
  adj: number[][]               // index → neighbor indices (undirected, deduped, no self-loops)
  m: number                     // total edges (undirected)
}

/** Build an undirected, deduped adjacency list from arbitrary node/edge arrays. */
function buildAdjacency(nodes: Node[], edges: Edge[]): Adjacency {
  const index = new Map<string, number>()
  const ids: string[] = []
  for (const n of nodes) {
    if (!index.has(n.id)) { index.set(n.id, ids.length); ids.push(n.id) }
  }
  const sets: Array<Set<number>> = ids.map(() => new Set<number>())
  let m = 0
  for (const e of edges) {
    const a = index.get(e.from), b = index.get(e.to)
    if (a === undefined || b === undefined || a === b) continue   // skip dangling + self-loops
    if (!sets[a]!.has(b)) { sets[a]!.add(b); sets[b]!.add(a); m++ }
  }
  return { ids, index, adj: sets.map((s) => [...s]), m }
}

// ─── PageRank — power iteration, damping 0.85 ──────────────────────────────────
function pageRank(g: Adjacency, { damping = 0.85, iterations = 60, tolerance = 1e-6 } = {}): Float64Array {
  const n = g.ids.length
  const pr = new Float64Array(n).fill(1 / Math.max(1, n))
  if (n === 0) return pr
  const deg = g.adj.map((a) => a.length)
  for (let it = 0; it < iterations; it++) {
    const next = new Float64Array(n)
    let dangling = 0
    for (let i = 0; i < n; i++) if (deg[i] === 0) dangling += pr[i]!
    const base = (1 - damping) / n + (damping * dangling) / n
    next.fill(base)
    for (let i = 0; i < n; i++) {
      const share = deg[i] ? (damping * pr[i]!) / deg[i]! : 0
      if (!share) continue
      for (const j of g.adj[i]!) next[j]! += share
    }
    let diff = 0
    for (let i = 0; i < n; i++) diff += Math.abs(next[i]! - pr[i]!)
    pr.set(next)
    if (diff < tolerance) break
  }
  return pr
}

// ─── Louvain — modularity-optimizing community detection ───────────────────────
// Phase 1 (local moving): greedily move each node into the neighbour community that yields the
// largest modularity gain, until stable. Phase 2 (aggregation): collapse communities into super-
// nodes and repeat. A few levels capture the hierarchical structure. Weighted to support phase-2.
interface WGraph { n: number; adj: Array<Array<[number, number]>>; selfLoop: number[]; m2: number }

function toWeighted(g: Adjacency): WGraph {
  const adj: Array<Array<[number, number]>> = g.adj.map((nbrs) => nbrs.map((j) => [j, 1] as [number, number]))
  return { n: g.ids.length, adj, selfLoop: new Array(g.ids.length).fill(0), m2: g.m * 2 }
}

function louvainLevel(wg: WGraph): { comm: number[]; improved: boolean } {
  const { n, adj, selfLoop, m2 } = wg
  if (m2 === 0) return { comm: adj.map((_, i) => i), improved: false }
  const degree = new Float64Array(n)
  for (let i = 0; i < n; i++) { let d = selfLoop[i]! * 2; for (const [, w] of adj[i]!) d += w; degree[i] = d }
  const comm = new Array(n); for (let i = 0; i < n; i++) comm[i] = i
  const commTot = Float64Array.from(degree)   // total degree of nodes in each community
  let improvedAny = false, moved = true, guard = 0
  while (moved && guard++ < 50) {
    moved = false
    for (let i = 0; i < n; i++) {
      const ci = comm[i]
      // weight from i into each neighbouring community
      const wTo = new Map<number, number>()
      for (const [j, w] of adj[i]!) { if (j === i) continue; const cj = comm[j]; wTo.set(cj, (wTo.get(cj) ?? 0) + w) }
      // remove i from its community
      commTot[ci]! -= degree[i]!
      let best = ci, bestGain = 0
      const ki = degree[i]!
      for (const [c, wic] of wTo) {
        // ΔQ ∝ w(i,c) - tot[c]*k_i / 2m  (constant terms dropped — we compare gains)
        const gain = wic - (commTot[c]! * ki) / m2
        if (gain > bestGain) { bestGain = gain; best = c }
      }
      // staying put gain (relative to empty) is wTo(ci) - ... already captured if ci ∈ wTo
      commTot[best]! += degree[i]!
      if (best !== ci) { comm[i] = best; moved = true; improvedAny = true }
    }
  }
  return { comm, improved: improvedAny }
}

function aggregate(wg: WGraph, comm: number[]): { wg: WGraph; map: number[] } {
  // renumber communities to 0..k-1
  const remap = new Map<number, number>()
  const map = comm.map((c) => { if (!remap.has(c)) remap.set(c, remap.size); return remap.get(c)! })
  const k = remap.size
  const adj: Array<Map<number, number>> = Array.from({ length: k }, () => new Map())
  const selfLoop = new Array(k).fill(0)
  for (let i = 0; i < wg.n; i++) {
    const ci = map[i]!
    selfLoop[ci] += wg.selfLoop[i]!
    for (const [j, w] of wg.adj[i]!) {
      const cj = map[j]!
      if (ci === cj) { if (i <= j) selfLoop[ci] += w }   // intra-community edge → self loop (count once)
      else adj[ci]!.set(cj, (adj[ci]!.get(cj) ?? 0) + w)
    }
  }
  const adjArr = adj.map((mp) => [...mp.entries()] as Array<[number, number]>)
  return { wg: { n: k, adj: adjArr, selfLoop, m2: wg.m2 }, map }
}

function louvain(g: Adjacency, maxLevels = 6): number[] {
  let wg = toWeighted(g)
  let nodeToComm = g.ids.map((_, i) => i)   // final community per ORIGINAL node
  for (let level = 0; level < maxLevels; level++) {
    const { comm, improved } = louvainLevel(wg)
    const { wg: agg, map } = aggregate(wg, comm)
    // compose: original node → its node in this level (nodeToComm currently maps orig→level-node) → new community
    for (let i = 0; i < nodeToComm.length; i++) nodeToComm[i] = map[nodeToComm[i]!]!
    wg = agg
    if (!improved || agg.n === wg.n && agg.n <= 1) break
    if (agg.n === 1) break
  }
  return nodeToComm
}

function modularity(g: Adjacency, comm: number[]): number {
  if (g.m === 0) return 0
  const m2 = g.m * 2
  const deg = g.adj.map((a) => a.length)
  let intra = 0
  const commDeg = new Map<number, number>()
  for (let i = 0; i < g.ids.length; i++) {
    commDeg.set(comm[i]!, (commDeg.get(comm[i]!) ?? 0) + deg[i]!)
    for (const j of g.adj[i]!) if (comm[i] === comm[j] && i < j) intra += 2   // each undirected edge counted once → ×2 for A_ij+A_ji
  }
  let q = intra / m2
  for (const [, d] of commDeg) q -= (d / m2) ** 2
  return q
}

// ─── Betweenness — Brandes' algorithm (unweighted) ─────────────────────────────
// O(V·E). For very large graphs we sample source nodes (approximate betweenness) so a growing
// personal graph never stalls the endpoint.
function betweenness(g: Adjacency, opts: { maxExactNodes?: number; sampleSize?: number } = {}): { bc: Float64Array; approximated: boolean } {
  const n = g.ids.length
  const bc = new Float64Array(n)
  if (n === 0) return { bc, approximated: false }
  const maxExact = opts.maxExactNodes ?? 2500
  const approximated = n > maxExact
  const sampleSize = approximated ? (opts.sampleSize ?? 800) : n
  // deterministic stride sampling (no RNG — keeps results stable across runs)
  const sources: number[] = []
  if (approximated) { const stride = Math.max(1, Math.floor(n / sampleSize)); for (let s = 0; s < n; s += stride) sources.push(s) }
  else for (let s = 0; s < n; s++) sources.push(s)

  for (const s of sources) {
    const stack: number[] = []
    const pred: number[][] = Array.from({ length: n }, () => [])
    const sigma = new Float64Array(n); sigma[s] = 1
    const dist = new Int32Array(n).fill(-1); dist[s] = 0
    const queue: number[] = [s]
    let qh = 0
    while (qh < queue.length) {
      const v = queue[qh++]!
      stack.push(v)
      for (const w of g.adj[v]!) {
        if (dist[w]! < 0) { dist[w] = dist[v]! + 1; queue.push(w) }
        if (dist[w] === dist[v]! + 1) { sigma[w]! += sigma[v]!; pred[w]!.push(v) }
      }
    }
    const delta = new Float64Array(n)
    while (stack.length) {
      const w = stack.pop()!
      for (const v of pred[w]!) delta[v]! += (sigma[v]! / sigma[w]!) * (1 + delta[w]!)
      if (w !== s) bc[w]! += delta[w]!
    }
  }
  // scale sampled estimate back up to full-graph magnitude
  if (approximated && sources.length > 0) { const scale = n / sources.length; for (let i = 0; i < n; i++) bc[i]! *= scale }
  return { bc, approximated }
}

function normalize(arr: Float64Array): Float64Array {
  let max = 0; for (const v of arr) if (v > max) max = v
  if (max <= 0) return arr
  const out = new Float64Array(arr.length); for (let i = 0; i < arr.length; i++) out[i] = arr[i]! / max
  return out
}

/** Run the full GDS suite. Pure + deterministic — same graph → same metrics. */
export function computeAnalytics(nodes: Node[], edges: Edge[], opts: { maxBetweennessNodes?: number; topK?: number } = {}): GraphAnalytics {
  const g = buildAdjacency(nodes, edges)
  const n = g.ids.length
  const topK = opts.topK ?? 12

  const pr = pageRank(g)
  const comm = louvain(g)
  const { bc, approximated } = betweenness(g, { maxExactNodes: opts.maxBetweennessNodes })
  const q = modularity(g, comm)

  const prNorm = normalize(pr)
  const bcNorm = normalize(bc)

  const nodeMetrics: Record<string, NodeMetrics> = {}
  for (let i = 0; i < n; i++) {
    const deg = g.adj[i]!.length
    nodeMetrics[g.ids[i]!] = {
      id: g.ids[i]!,
      degree: deg,
      pagerank: prNorm[i]!,
      betweenness: bcNorm[i]!,
      community: deg === 0 ? -1 : comm[i]!,
    }
  }

  // group into communities, rank members by pagerank, drop singletons of isolated nodes
  const byComm = new Map<number, string[]>()
  for (let i = 0; i < n; i++) {
    const c = nodeMetrics[g.ids[i]!]!.community
    if (c < 0) continue
    if (!byComm.has(c)) byComm.set(c, [])
    byComm.get(c)!.push(g.ids[i]!)
  }
  const communities: CommunitySummary[] = [...byComm.entries()]
    .map(([id, members]) => {
      members.sort((a, b) => nodeMetrics[b]!.pagerank - nodeMetrics[a]!.pagerank)
      return { id, size: members.length, members, topNodes: members.slice(0, 5) }
    })
    .filter((c) => c.size >= 2)                       // a "community" needs ≥2 nodes
    .sort((a, b) => b.size - a.size)

  const sortedByPr = Object.values(nodeMetrics).sort((a, b) => b.pagerank - a.pagerank)
  const sortedByBc = Object.values(nodeMetrics).sort((a, b) => b.betweenness - a.betweenness)

  return {
    nodes: nodeMetrics,
    communities,
    modularity: q,
    summary: {
      nodeCount: n,
      edgeCount: g.m,
      communityCount: communities.length,
      topByPagerank: sortedByPr.slice(0, topK).map((m) => ({ id: m.id, score: Number(m.pagerank.toFixed(4)) })),
      topByBetweenness: sortedByBc.slice(0, topK).filter((m) => m.betweenness > 0).map((m) => ({ id: m.id, score: Number(m.betweenness.toFixed(4)) })),
      betweennessApproximated: approximated,
    },
  }
}
