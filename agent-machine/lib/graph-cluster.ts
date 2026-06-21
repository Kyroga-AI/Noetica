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
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { GraphNode, GraphEdge } from '@socioprophet/hellgraph'
import { embedBatchLocal } from './embed-runtime.js'
import { cleanLabel, categoryFor, kindOf, type SurfaceResult, type SurfaceNode, type SurfaceLink } from './graph-surface.js'
import { classifyTerms, titleCaseTopic } from './slash-topics.js'
import { isActionLabel } from './graph-hygiene.js'

// Words that are tool params, shell/command fragments, or generic instance noise — never topics.
const NOISE = new Set([
  'name', 'arguments', 'path', 'content', 'query', 'input', 'output', 'type', 'properties', 'required',
  'description', 'parameters', 'value', 'key', 'id', 'args', 'params', 'prompt', 'language',
  'copy', 'bash', 'sh', 'zsh', 'npm', 'install', 'run', 'dev', 'build', 'test', 'hello', 'world',
  'true', 'false', 'null', 'none', 'todo', 'note', 'tmp', 'temp', 'trash', 'cache', 'log', 'logs',
  'node', 'next', 'env', 'src', 'lib', 'bin', 'dist', 'main', 'index', 'config', 'data', 'file', 'files',
  'package', 'lock', 'json', 'yaml', 'toml', 'md', 'txt', 'operation', 'write', 'read', 'string', 'number',
  // CSS properties / installers / generic UI+message nouns that kept leaking in as fake topics.
  'margin', 'padding', 'top', 'bottom', 'left', 'right', 'width', 'height', 'color', 'border', 'flex',
  'app', 'apps', 'dmg', 'pkg', 'exe', 'message', 'high', 'low', 'level', 'item', 'list', 'view', 'page',
  'output', 'plaintext', 'call', 'result', 'error', 'tool', 'hello', 'reverse', 'reversed', 'reverse_string',
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
  if (/[(){}[\]<>$="'!?:;]/.test(l)) return false                 // code/param/output fragments ("Output:", "!acitoeN")
  const lc = l.toLowerCase()
  const words = lc.split(/[\s,-]+/).filter(Boolean)
  if (words.some((w) => /\d/.test(w))) return false                          // version/output tokens ("8.15.0", "v16.1")
  if (words.some((w) => NOISE.has(w) || STOP.has(w))) return false           // any generic/sentence word → not a topic
  if (words.length >= 2 && words.every((w) => w === words[0])) return false  // "Noetica Noetica"
  return true
}

// Provenance / operational exhaust that should NOT surface as a concept in the graph — session
// file/symbol atoms, paths, temp/trash, bare shell commands, hash-y ids. Used to keep the
// drill-down "instance layer" as legible sub-topics rather than the agent's own tool activity.
const OPERATIONAL_TYPES = /^(File|Symbol|Session|Turn|Claim|Probe|Event|Run|Heartbeat|Lock)$/i
// A drilled neighbour is junk if it's a provenance/operational atom type OR its label doesn't
// read as a clean concept (paths, snake_case code, commands, output fragments, version strings,
// reversed gibberish all fail isClean). Keeps the instance layer to legible sub-topics.
function isJunkNode(n: GraphNode | undefined): boolean {
  if (!n) return true
  if (OPERATIONAL_TYPES.test(n.labels?.[0] ?? '')) return true
  const l = (cleanLabel(n) ?? '').trim()
  return !l || !isClean(l)
}

// Synthesize a CLASS name for a cluster from the theme its members share, instead of picking
// one member (always an instance). Split member labels into tokens, drop noise/stopwords, and
// take the token(s) shared by ≥2 members as the abstract class — {tauri-apps, plugin-dialog,
// plugin-shell} → "Plugin", {model-router, model-store} → "Model". Returns null when members
// share no theme (caller then falls back to the centroid-closest member label).
function tokenize(s: string): string[] {
  // Split camelCase BEFORE lowercasing, or "GovernanceTrail" collapses to one token.
  return s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s\-_./]+/).filter(Boolean)
}
function className(memberLabels: string[]): string | null {
  if (memberLabels.length < 2) return null
  const freq = new Map<string, number>()
  for (const lab of memberLabels) {
    const seen = new Set<string>()
    for (const t of tokenize(lab)) {
      if (t.length < 3 || NOISE.has(t) || STOP.has(t)) continue
      if (seen.has(t)) continue
      seen.add(t)
      freq.set(t, (freq.get(t) ?? 0) + 1)
    }
  }
  const ranked = [...freq.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
  if (!ranked.length) return null
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)
  // Primary theme, plus a distinct secondary if it's nearly as common — "Model Router".
  const primary = ranked[0]!
  const secondary = ranked.find(([t, c]) => t !== primary[0] && c >= Math.max(2, primary[1] - 1))
  return secondary ? `${cap(primary[0])} ${cap(secondary[0])}` : cap(primary[0])
}

// Friendly names for the raw HellGraph atom types, so a theme-less cluster is still named by
// its ONTOLOGICAL class (the type its members actually are) instead of a member instance.
const TYPE_CLASS: Record<string, string> = {
  Model: 'Models', Provider: 'Providers', Repo: 'Repositories', Repository: 'Repositories',
  Tool: 'Tools', Action: 'Actions', Artifact: 'Artifacts', Feature: 'Features', Vector: 'Vectors',
  Candidate: 'Candidates', Checkpoint: 'Checkpoints', Attention: 'Attention', Topic: 'Topics',
  Domain: 'Domains', GlossaryTerm: 'Glossary', Concept: 'Concepts', Document: 'Documents',
  Entity: 'Entities', Person: 'People', Org: 'Organizations', Session: 'Sessions', Event: 'Events',
}
// The dominant atom-type among a cluster's members, humanized into a class label. Falls back to
// splitting a camelCase/suffixed type so an unmapped type still reads as a class.
function typeClass(members: GraphNode[]): string | null {
  const freq = new Map<string, number>()
  for (const m of members) { const t = (m.labels?.[0] ?? '').trim(); if (t) freq.set(t, (freq.get(t) ?? 0) + 1) }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!top) return null
  // Normalize the raw atom type (SCREAMING_SNAKE like FEATURE_ATOM, camelCase, or PascalCase),
  // dropping a structural _ATOM/_NODE suffix, into Title Case — then map to a friendly plural.
  const words = top[0]
    .replace(/_?(atom|node|entity)$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
  if (!words.length) return null
  const titled = words.join(' ')
  return TYPE_CLASS[titled] ?? titled
}

// Deterministic PRNG (mulberry32) so topic discovery is STABLE across calls/restarts —
// k-means++ init must not use Math.random or the same graph yields different topics each load.
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// ── Embeddings (cached per node, reuses any stored vector) ──────────────────
const embedCache = new Map<string, number[]>()
// Reuse a cached or node-stored vector (no embedder call). The batch embedder fills the rest.
function readStored(n: GraphNode): number[] | null {
  const hit = embedCache.get(n.id); if (hit) return hit
  const stored = (n.properties as Record<string, unknown>)?.['embedding']
  if (stored != null) {
    try { const v = typeof stored === 'string' ? JSON.parse(stored) : stored; if (Array.isArray(v) && v.length) { embedCache.set(n.id, v as number[]); return v as number[] } } catch { /* fall through */ }
  }
  return null
}

function normalize(v: number[]): number[] { let s = 0; for (const x of v) s += x * x; const n = Math.sqrt(s) || 1; return v.map((x) => x / n) }
function dot(a: number[], b: number[]): number { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i]! * b[i]!; return s }

// Cosine k-means with k-means++ init. Vectors are pre-normalized so cosine == dot.
// Returns assignments AND the final centroids (needed for silhouette + centroid reps).
function kmeans(V: number[][], k: number, seed: number, iters = 18): { assign: number[]; centers: number[][] } {
  const n = V.length
  if (n <= k) return { assign: V.map((_, i) => i), centers: V.map((v) => v.slice()) }
  const d = V[0]!.length
  const rand = rng(seed)
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
  return { assign, centers }
}

// TRUE pairwise silhouette (cosine). a(i) = mean intra-cluster distance to OTHER members;
// b(i) = min over other clusters of mean distance. Singletons score 0 (convention) — this is
// what kills the "split into all-singletons → score 1" degeneracy a centroid silhouette has.
// O(n²) but n ≤ 320 and it's computed once per dataset (cached), so it's fine.
function silhouette(V: number[][], assign: number[], k: number): number {
  const n = V.length
  if (n === 0) return -1
  const groups: number[][] = Array.from({ length: k }, () => [])
  for (let i = 0; i < n; i++) groups[assign[i]!]!.push(i)
  let sum = 0
  for (let i = 0; i < n; i++) {
    const own = assign[i]!, g = groups[own]!
    if (g.length <= 1) continue                                   // singleton → s=0
    let a = 0; for (const j of g) if (j !== i) a += 1 - dot(V[i]!, V[j]!); a /= (g.length - 1)
    let b = Infinity
    for (let c = 0; c < k; c++) {
      if (c === own || groups[c]!.length === 0) continue
      let m = 0; for (const j of groups[c]!) m += 1 - dot(V[i]!, V[j]!); m /= groups[c]!.length
      if (m < b) b = m
    }
    if (!isFinite(b)) continue
    sum += (b - a) / (Math.max(a, b) || 1)
  }
  return sum / n
}

// Discover the NATURAL number of topics: sweep k ∈ [kMin,kMax], pick argmax mean silhouette.
// Deterministic (seed varies per k but is fixed). Caller caps kMax ≪ n so clusters can't all
// collapse to singletons; kMin ≥ a floor so we don't get 2–3 mega-blobs.
function discoverK(V: number[][], kMin: number, kMax: number): { assign: number[]; centers: number[][]; k: number; score: number } {
  const base = 0x9e3779b1 ^ (V.length * 2654435761)
  let best = { assign: [] as number[], centers: [] as number[][], k: kMin, score: -2 }
  for (let k = kMin; k <= kMax; k++) {
    const { assign, centers } = kmeans(V, k, base ^ (k * 40503))
    const score = silhouette(V, assign, k)
    if (score > best.score) best = { assign, centers, k, score }
  }
  return best
}

interface Clustering { reps: string[]; members: Map<string, string[]>; clusterOf: Map<string, string>; classNames: Map<string, string> }
const clusterCache = new Map<string, Clustering>()

// ── Incremental persistence ─────────────────────────────────────────────────
// Topic discovery (embed + silhouette + k-means) is expensive and was rebuilt FROM SCRATCH every
// launch. Persist the result to disk keyed by a content hash of the candidate set; an unchanged
// graph reloads instantly instead of reprocessing. Recompute only when the candidates actually
// change. (Full delta-level incrementality — regis graph_delta — is the next step up from this.)
const CACHE_DIR = path.join(os.homedir(), '.noetica', 'cache')
function cheapHash(s: string): string { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) }
function cacheFile(view: string): string { return path.join(CACHE_DIR, `graph-cluster-${view.replace(/[^a-z0-9]/gi, '_')}.json`) }
function loadPersisted(view: string, hash: string): Clustering | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(view), 'utf8')) as { hash: string; reps: string[]; members: [string, string[]][]; clusterOf: [string, string][]; classNames: [string, string][] }
    if (raw.hash !== hash) return null
    return { reps: raw.reps, members: new Map(raw.members), clusterOf: new Map(raw.clusterOf), classNames: new Map(raw.classNames) }
  } catch { return null }
}
function persist(view: string, hash: string, cl: Clustering): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(cacheFile(view), JSON.stringify({ hash, reps: cl.reps, members: [...cl.members], clusterOf: [...cl.clusterOf], classNames: [...cl.classNames] }))
  } catch { /* best-effort cache */ }
}

/** Async, clustered replacement for selectSurface on a category lens (tech/knowledge). */
export async function clusterSurface(allNodes: GraphNode[], allEdges: GraphEdge[], opts: { view: string; root?: string; k?: number; category: string }): Promise<SurfaceResult> {
  const limit = opts.k ?? 22   // display cap — the natural topic count is DISCOVERED below, then shown up to this

  const degree = new Map<string, number>()
  for (const e of allEdges) { degree.set(e.from, (degree.get(e.from) ?? 0) + 1); degree.set(e.to, (degree.get(e.to) ?? 0) + 1) }

  // Candidate set: clean, in-category, capped to the 320 highest-degree (bounds embed cost).
  const cands = allNodes
    .map((n) => ({ n, label: cleanLabel(n) }))
    .filter((x): x is { n: GraphNode; label: string } => !!x.label && x.n.properties?.['hygiene_pruned'] !== true && isClean(x.label) && !isActionLabel(x.label) && categoryFor(x.n.labels[0] ?? '') === opts.category)
    .sort((a, b) => (degree.get(b.n.id) ?? 0) - (degree.get(a.n.id) ?? 0))
    .slice(0, 120)   // bound embed cost — 120 top clean concepts is plenty for topic discovery
  const byId = new Map(cands.map((x) => [x.n.id, x.n]))

  // Content hash of the candidate set — the clustering is a pure function of it, so an unchanged
  // graph reuses the in-memory OR on-disk result and never reprocesses on launch.
  const sig = cheapHash(cands.map((x) => `${x.n.id}|${x.label}`).sort().join('\n'))
  const cacheKey = `${opts.view}:${sig}`
  let cl = clusterCache.get(cacheKey) ?? loadPersisted(opts.view, sig) ?? undefined
  if (cl && !clusterCache.has(cacheKey)) clusterCache.set(cacheKey, cl)
  if (!cl) {
    // Vectorize with OUR OWN embedder (the noetica-embed Rust sidecar) in a single batch call —
    // no ollama. Reuse any cached/stored vector first; embed only what's missing. If the embedder
    // isn't available, embeds stay null and we degrade to the clean degree-rank fallback below.
    const embeds: (number[] | null)[] = new Array(cands.length).fill(null)
    const need: number[] = []
    cands.forEach((x, i) => { const s = readStored(x.n); if (s) embeds[i] = s; else need.push(i) })
    if (need.length) {
      const local = await embedBatchLocal(need.map((i) => `${cands[i]!.n.labels[0] ?? ''}: ${cands[i]!.label}`))
      if (local) need.forEach((i, k) => { const v = local[k]; if (v) { embedCache.set(cands[i]!.n.id, v); embeds[i] = v } })
    }
    const vecs: number[][] = []; const valid: GraphNode[] = []
    cands.forEach((x, i) => { if (embeds[i]) { vecs.push(normalize(embeds[i]!)); valid.push(x.n) } })
    const reps: string[] = []; const members = new Map<string, string[]>(); const clusterOf = new Map<string, string>()
    const classNames = new Map<string, string>()
    const labelOf = new Map(cands.map((x) => [x.n.id, x.label]))
    const usedLabels = new Set<string>()
    if (valid.length === 0) {
      // Embeddings cold → clean degree-rank so we still surface TOPICS (clean, in-category
      // labels), never letting the route fall back to raw file-path/instance noise.
      for (const x of cands.slice(0, limit)) { reps.push(x.n.id); members.set(x.n.id, [x.n.id]); clusterOf.set(x.n.id, x.n.id) }
    } else if (valid.length <= 8) {
      for (const n of valid) { reps.push(n.id); members.set(n.id, [n.id]); clusterOf.set(n.id, n.id) }
    } else {
      const vecOf = new Map<string, number[]>(); valid.forEach((n, i) => vecOf.set(n.id, vecs[i]!))
      // Discover the natural topic count by silhouette (not a hardcoded 22). kMax ≤ n/2 so
      // clusters average ≥2 members (no all-singletons degeneracy).
      const kMax = Math.min(40, Math.floor(valid.length / 2))
      const kMin = Math.min(6, kMax)
      const { assign, k: discoveredK, score } = discoverK(vecs, kMin, kMax)
      console.warn(`[graph-cluster] ${opts.view}: discovered k=${discoveredK} (silhouette ${score.toFixed(3)}) from ${valid.length} nodes`)
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
        // CLASS name from the theme the members share — falls back to the centroid member's
        // own label when the cluster has no shared theme. This is what makes the top layer read
        // as topic CLASSES ("Model Router", "Plugin") rather than instances ("tauri-apps").
        // Class name: shared-theme first; else the cluster's dominant ONTOLOGICAL type — but
        // when that type is a generic container (most tech atoms are FEATURE_ATOM), the rep's
        // distinctive token IS the real topic ("Memory", "Guardrail"), so prefer that over a
        // repetitive "Features"; only as a last resort the rep's own label.
        const GENERIC_TYPES = new Set(['Features', 'Artifacts', 'Vectors', 'Nodes', 'Candidates', 'Entities', 'Concepts', 'Actions'])
        const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)
        const memberLabels = g.map((m) => labelOf.get(m.id) ?? '')
        // GROUND in the slash-topic taxonomy first — a canonical blekko topic the cluster covers
        // ("Artificial Intelligence", "Cloud", "Databases") beats an ad-hoc synthesized name.
        const taxo = classifyTerms(memberLabels)
        const themed = className(memberLabels)
        const tc = typeClass(g)
        const distinct = tokenize(labelOf.get(rep.id) ?? '').find((t) => t.length >= 3 && !NOISE.has(t) && !STOP.has(t))
        let cname = (taxo ? titleCaseTopic(taxo.topic) : null)
          ?? themed
          ?? ((tc && GENERIC_TYPES.has(tc) && distinct) ? cap(distinct) : null)
          ?? tc
          ?? (labelOf.get(rep.id) ?? '')
        let dedupKey = cname.toLowerCase()
        if (usedLabels.has(dedupKey)) {
          // Two clusters landed on the same class (e.g. "Models"): disambiguate with a DIFFERENT
          // distinctive token instead of dropping a whole topic.
          const alt = tokenize(labelOf.get(rep.id) ?? '').find((t) => t.length >= 3 && !NOISE.has(t) && !STOP.has(t) && !dedupKey.includes(t))
          if (alt) { cname = `${cname} · ${cap(alt)}`; dedupKey = cname.toLowerCase() }
          if (usedLabels.has(dedupKey)) continue
        }
        usedLabels.add(dedupKey)
        classNames.set(rep.id, cname)
        reps.push(rep.id); members.set(rep.id, g.map((n) => n.id)); for (const m of g) clusterOf.set(m.id, rep.id)
      }
    }
    cl = { reps, members, clusterOf, classNames }
    clusterCache.set(cacheKey, cl)
    persist(opts.view, sig, cl)   // survive restarts — no rebuild next launch unless the graph changed
  }

  // Top-level → the discovered topics (the CLASS layer), shown up to the display limit
  // (most-connected first) so a data-driven k > limit still renders cleanly.
  const topicReps = cl.reps.slice().sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0)).slice(0, limit)

  // Drill-down → LAYERED: the concept's own cluster members PLUS their 1-hop graph neighbours,
  // i.e. the concrete INSTANCE layer (files, code, raw nodes) sitting beneath the abstract topic.
  // This is the outer(class)/inner(instance) distinction made visible.
  const allById = new Map(allNodes.map((n) => [n.id, n]))   // for drill-neighbour lookup + junk filtering
  let ids: string[]
  if (opts.root && cl.members.has(opts.root)) {
    const members = cl.members.get(opts.root)!
    const memberSet = new Set(members)
    const set = new Set(members)
    for (const e of allEdges) {
      if (set.size >= 28) break
      // Only surface CONCEPT neighbours — skip file/symbol/path/command provenance so the
      // instance layer reads as sub-topics, not the agent's operational exhaust.
      if (memberSet.has(e.from) && !set.has(e.to) && !isJunkNode(allById.get(e.to))) set.add(e.to)
      else if (memberSet.has(e.to) && !set.has(e.from) && !isJunkNode(allById.get(e.from))) set.add(e.from)
    }
    ids = [...set].slice(0, 28)
  } else {
    ids = topicReps
  }
  const keep = new Set(ids)
  const maxDeg = Math.max(1, ...ids.map((id) => degree.get(id) ?? 0))
  const nodes: SurfaceNode[] = ids.flatMap((id) => {
    const n = allById.get(id); if (!n) return []
    const deg = degree.get(id) ?? 0
    const isTopic = cl.members.has(id)   // a representative = a topic (class layer)
    // Topic reps render as their synthesized CLASS name; instances (drill-down) keep their own.
    const label = (isTopic ? cl.classNames.get(id) : null) ?? cleanLabel(n) ?? (n.labels[0] ?? 'node')
    return [{ id, label, category: categoryFor(n.labels[0] ?? ''), kind: isTopic ? 'Concept' : kindOf(n.labels[0] ?? ''), featured: isTopic || deg >= maxDeg * 0.6, degree: deg }]
  })

  const links: SurfaceLink[] = []
  if (opts.root) {
    // member view: real edges between members (capped per node for legibility)
    const shown = new Map<string, number>(); const CAP = 3
    for (const e of allEdges) {
      if (!keep.has(e.from) || !keep.has(e.to) || e.from === e.to) continue
      if ((shown.get(e.from) ?? 0) >= CAP || (shown.get(e.to) ?? 0) >= CAP) continue
      shown.set(e.from, (shown.get(e.from) ?? 0) + 1); shown.set(e.to, (shown.get(e.to) ?? 0) + 1)
      links.push({ source: e.from, target: e.to, primary: (degree.get(e.from) ?? 0) >= maxDeg * 0.6, epistemic: 'extracted' })
    }
  } else {
    // topic view: inter-cluster connectivity (A↔B if any member edge crosses)
    const seen = new Set<string>()
    for (const e of allEdges) {
      const ra = cl.clusterOf.get(e.from), rb = cl.clusterOf.get(e.to)
      if (!ra || !rb || ra === rb || !keep.has(ra) || !keep.has(rb)) continue
      const key = ra < rb ? `${ra}|${rb}` : `${rb}|${ra}`
      if (seen.has(key)) continue; seen.add(key)
      links.push({ source: ra, target: rb, primary: false, epistemic: 'inferred' })
    }
  }

  return { nodes, links, total: { nodes: allNodes.length, edges: allEdges.length } }
}
