/**
 * graph-cluster — TRUE topic discovery for the graph surface.
 *
 * Instead of "sort by degree, slice top 22" (a popularity heuristic), this VECTORIZES
 * node labels (nomic embeddings), CLUSTERS them with cosine k-means into 22 outer topics,
 * and surfaces each cluster's representative as a top-level topic. Drilling into a topic
 * returns that cluster's members (the inner sub-topics). Top-level edges are inter-cluster
 * connectivity (cluster A links B if any member of A connects to any member of B), so it
 * reads as a real topic graph. Embeddings + cluster assignments are cached per process.
 */
import type { GraphNode, GraphEdge } from '@socioprophet/hellgraph'
import { embedText } from './ollama.js'
import { cleanLabel, categoryFor, type SurfaceResult, type SurfaceNode, type SurfaceLink } from './graph-surface.js'

// Words that are tool params, shell/command fragments, or generic instance noise — never topics.
const NOISE = new Set([
  'name', 'arguments', 'path', 'content', 'query', 'input', 'output', 'type', 'properties', 'required',
  'description', 'parameters', 'value', 'key', 'id', 'args', 'params', 'prompt', 'language',
  'copy', 'bash', 'sh', 'zsh', 'npm', 'install', 'run', 'dev', 'build', 'test', 'hello', 'world',
  'true', 'false', 'null', 'none', 'todo', 'note', 'tmp', 'temp', 'trash', 'cache', 'log', 'logs',
  'node', 'next', 'env', 'src', 'lib', 'bin', 'dist', 'main', 'index', 'config', 'data', 'file', 'files',
  'package', 'lock', 'json', 'yaml', 'toml', 'md', 'txt', 'operation', 'write', 'read', 'string', 'number',
])
// Natural-language words → the label is a description/comment fragment, not a topic.
const STOP = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were', 'be', 'it', 'its',
  'takes', 'take', 'defines', 'define', 'returns', 'return', 'your', 'you', 'with', 'for', 'of', 'to',
  'and', 'or', 'in', 'on', 'code', 'function', 'method', 'class', 'uses', 'use', 'using', 'when', 'if',
])
// A label is a TOPIC (a class), not an instance, if it reads like a concept — not a file path,
// dotfile, code identifier (snake_case), model tag (7b/3b), number, command, or generic noun.
function isClean(label: string): boolean {
  const l = label.trim()
  if (l.length < 3 || l.length > 40) return false
  if (l.includes('/') || /^[.~]/.test(l)) return false           // paths / dotfiles
  if (l.includes('_')) return false                               // snake_case code identifiers
  if (/^\d/.test(l) || /^\d+\s*b$/i.test(l)) return false         // numbers, model tags (7b, 3b)
  if (/[(){}[\]<>$="']/.test(l)) return false                     // code/param fragments
  const lc = l.toLowerCase()
  const words = lc.split(/[\s-]+/)
  if (words.some((w) => NOISE.has(w) || STOP.has(w))) return false           // any generic/sentence word → not a topic
  if (words.length >= 2 && words.every((w) => w === words[0])) return false  // "Noetica Noetica"
  return true
}

// Deterministic PRNG (mulberry32) so topic discovery is STABLE across calls/restarts —
// k-means++ init must not use Math.random or the same graph yields different topics each load.
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// ── Embeddings (cached per node, reuses any stored vector) ──────────────────
const embedCache = new Map<string, number[]>()
async function embedNode(n: GraphNode, label: string): Promise<number[] | null> {
  const hit = embedCache.get(n.id); if (hit) return hit
  const stored = (n.properties as Record<string, unknown>)?.['embedding']
  if (stored != null) {
    try { const v = typeof stored === 'string' ? JSON.parse(stored) : stored; if (Array.isArray(v) && v.length) { embedCache.set(n.id, v as number[]); return v as number[] } } catch { /* fall through */ }
  }
  try { const v = await embedText(`${n.labels[0] ?? ''}: ${label}`); if (v?.length) { embedCache.set(n.id, v); return v } } catch { /* embed model down */ }
  return null
}

function normalize(v: number[]): number[] { let s = 0; for (const x of v) s += x * x; const n = Math.sqrt(s) || 1; return v.map((x) => x / n) }
function dot(a: number[], b: number[]): number { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i]! * b[i]!; return s }

// Cosine k-means with k-means++ init. Vectors are pre-normalized so cosine == dot.
function kmeans(V: number[][], k: number, iters = 18): number[] {
  const n = V.length
  if (n <= k) return V.map((_, i) => i)
  const d = V[0]!.length
  const rand = rng(0x9e3779b1 ^ (n * 2654435761))   // seed from size → deterministic per dataset
  const centers: number[][] = [V[Math.floor(rand() * n)]!.slice()]
  while (centers.length < k) {
    const dist = V.map((v) => { let best = -1; for (const c of centers) { const s = dot(v, c); if (s > best) best = s } return Math.max(1e-6, 1 - best) })
    let sum = 0; for (const x of dist) sum += x; let r = rand() * sum, idx = 0
    for (let i = 0; i < n; i++) { r -= dist[i]!; if (r <= 0) { idx = i; break } }
    centers.push(V[idx]!.slice())
  }
  const assign = new Array(n).fill(0)
  for (let it = 0; it < iters; it++) {
    let moved = false
    for (let i = 0; i < n; i++) { let best = -2, bi = 0; for (let c = 0; c < k; c++) { const s = dot(V[i]!, centers[c]!); if (s > best) { best = s; bi = c } } if (assign[i] !== bi) { assign[i] = bi; moved = true } }
    const sums = Array.from({ length: k }, () => new Array(d).fill(0)); const cnt = new Array(k).fill(0)
    for (let i = 0; i < n; i++) { const c = assign[i]; cnt[c]++; const v = V[i]!; for (let j = 0; j < d; j++) sums[c]![j] += v[j]! }
    for (let c = 0; c < k; c++) if (cnt[c] > 0) centers[c] = normalize(sums[c]!)
    if (!moved && it > 0) break
  }
  return assign
}

interface Clustering { reps: string[]; members: Map<string, string[]>; clusterOf: Map<string, string> }
const clusterCache = new Map<string, Clustering>()

/** Async, clustered replacement for selectSurface on a category lens (tech/knowledge). */
export async function clusterSurface(allNodes: GraphNode[], allEdges: GraphEdge[], opts: { view: string; root?: string; k?: number; category: string }): Promise<SurfaceResult> {
  const k = opts.k ?? 22

  const degree = new Map<string, number>()
  for (const e of allEdges) { degree.set(e.from, (degree.get(e.from) ?? 0) + 1); degree.set(e.to, (degree.get(e.to) ?? 0) + 1) }

  // Candidate set: clean, in-category, capped to the 320 highest-degree (bounds embed cost).
  const cands = allNodes
    .map((n) => ({ n, label: cleanLabel(n) }))
    .filter((x): x is { n: GraphNode; label: string } => !!x.label && isClean(x.label) && categoryFor(x.n.labels[0] ?? '') === opts.category)
    .sort((a, b) => (degree.get(b.n.id) ?? 0) - (degree.get(a.n.id) ?? 0))
    .slice(0, 320)
  const byId = new Map(cands.map((x) => [x.n.id, x.n]))

  const cacheKey = `${opts.view}:${cands.length}`
  let cl = clusterCache.get(cacheKey)
  if (!cl) {
    const embeds = await Promise.all(cands.map((x) => embedNode(x.n, x.label)))
    const vecs: number[][] = []; const valid: GraphNode[] = []
    cands.forEach((x, i) => { if (embeds[i]) { vecs.push(normalize(embeds[i]!)); valid.push(x.n) } })
    const reps: string[] = []; const members = new Map<string, string[]>(); const clusterOf = new Map<string, string>()
    const labelOf = new Map(cands.map((x) => [x.n.id, x.label]))
    const usedLabels = new Set<string>()
    if (valid.length === 0) {
      // Embeddings cold → clean degree-rank so we still surface TOPICS (clean, in-category
      // labels), never letting the route fall back to raw file-path/instance noise.
      for (const x of cands.slice(0, k)) { reps.push(x.n.id); members.set(x.n.id, [x.n.id]); clusterOf.set(x.n.id, x.n.id) }
    } else if (valid.length <= k) {
      for (const n of valid) { reps.push(n.id); members.set(n.id, [n.id]); clusterOf.set(n.id, n.id) }
    } else {
      const vecOf = new Map<string, number[]>(); valid.forEach((n, i) => vecOf.set(n.id, vecs[i]!))
      const assign = kmeans(vecs, k)
      const groups = new Map<number, GraphNode[]>()
      valid.forEach((n, i) => { const g = groups.get(assign[i]) ?? []; g.push(n); groups.set(assign[i], g) })
      for (const g of groups.values()) {
        // Representative = member CLOSEST to the cluster centroid (the most representative
        // concept), not the highest-degree hub (which tends to be a noisy instance).
        const dim = vecOf.get(g[0]!.id)!.length
        const centroid = new Array(dim).fill(0)
        for (const m of g) { const v = vecOf.get(m.id)!; for (let j = 0; j < dim; j++) centroid[j] += v[j]! }
        const cc = normalize(centroid)
        let rep = g[0]!, best = -2
        for (const m of g) {
          const lab = (labelOf.get(m.id) ?? '').toLowerCase()
          const score = dot(vecOf.get(m.id)!, cc) + (lab.includes('-') ? 0.04 : 0) - (usedLabels.has(lab) ? 1 : 0)
          if (score > best) { best = score; rep = m }
        }
        const repLabel = (labelOf.get(rep.id) ?? '').toLowerCase()
        if (usedLabels.has(repLabel)) continue   // drop a cluster that only duplicates an existing topic
        usedLabels.add(repLabel)
        reps.push(rep.id); members.set(rep.id, g.map((n) => n.id)); for (const m of g) clusterOf.set(m.id, rep.id)
      }
    }
    cl = { reps, members, clusterOf }
    clusterCache.set(cacheKey, cl)
  }

  // Drill-down → that cluster's members; top-level → the cluster representatives.
  const ids = (opts.root && cl.members.has(opts.root)) ? cl.members.get(opts.root)!.slice(0, 30) : cl.reps
  const keep = new Set(ids)
  const maxDeg = Math.max(1, ...ids.map((id) => degree.get(id) ?? 0))
  const nodes: SurfaceNode[] = ids.map((id) => {
    const n = byId.get(id)!; const deg = degree.get(id) ?? 0
    return { id, label: cleanLabel(n) ?? (n.labels[0] ?? 'node'), category: categoryFor(n.labels[0] ?? ''), featured: deg >= maxDeg * 0.6, degree: deg }
  })

  const links: SurfaceLink[] = []
  if (opts.root) {
    // member view: real edges between members (capped per node for legibility)
    const shown = new Map<string, number>(); const CAP = 3
    for (const e of allEdges) {
      if (!keep.has(e.from) || !keep.has(e.to) || e.from === e.to) continue
      if ((shown.get(e.from) ?? 0) >= CAP || (shown.get(e.to) ?? 0) >= CAP) continue
      shown.set(e.from, (shown.get(e.from) ?? 0) + 1); shown.set(e.to, (shown.get(e.to) ?? 0) + 1)
      links.push({ source: e.from, target: e.to, primary: (degree.get(e.from) ?? 0) >= maxDeg * 0.6 })
    }
  } else {
    // topic view: inter-cluster connectivity (A↔B if any member edge crosses)
    const seen = new Set<string>()
    for (const e of allEdges) {
      const ra = cl.clusterOf.get(e.from), rb = cl.clusterOf.get(e.to)
      if (!ra || !rb || ra === rb || !keep.has(ra) || !keep.has(rb)) continue
      const key = ra < rb ? `${ra}|${rb}` : `${rb}|${ra}`
      if (seen.has(key)) continue; seen.add(key)
      links.push({ source: ra, target: rb, primary: false })
    }
  }

  return { nodes, links, total: { nodes: allNodes.length, edges: allEdges.length } }
}
