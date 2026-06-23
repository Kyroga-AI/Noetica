/**
 * retrieval.ts — Multi-pattern context retrieval for the agent-machine.
 *
 * Four patterns, each independently timed, are combined into a single
 * RetrievedContext payload. The caller controls which patterns run via opts.
 *
 * Patterns:
 *   graph            — BFS over HellGraph for entities extracted from the query
 *   temporal         — SPARQL for recent Messages, filtered by query keywords
 *   sparql           — Structured session interaction lookup (requires sessionId)
 *   cache-augmented  — Stable Ollama KV-cache prefix for the workspace session
 */

import { getGraph, graphSparql } from './graph.js'
import { buildWorkspacePrefix } from './context-cache.js'
import { findMatches, V, N, L } from '@socioprophet/hellgraph'
import type { Pattern } from '@socioprophet/hellgraph'
import { stiNorm } from '@socioprophet/hellgraph'
import type { PropertyValue } from '@socioprophet/hellgraph'
import { ingestInteraction } from '@socioprophet/hellgraph'
import { cairnPathExpand } from './cairnpath-adapter.js'
import { studyBrainRetrieve, studyBrainReady } from './study-brain.js'
import { generateOllamaText } from './ollama.js'
import { opsBrainRetrieve, opsBrainReady } from './ops-brain.js'
import { isSafeSessionId } from './session-id.js'
import * as crypto from 'node:crypto'

/** Sanitize a user value for logging: strip CR/LF so input can't forge log lines. CodeQL
 *  js/log-injection only recognizes String.replace of explicit "\r"/"\n" (the NewlineSanitizer
 *  barrier) — encodeURIComponent is NOT modeled as a log-injection sanitizer. */
function logSafe(s: unknown): string {
  try { return String(s).replace(/\r/g, '').replace(/\n/g, '').slice(0, 200) } catch { return '<unprintable>' }
}

// ─── WorkingMemoryState — mirrors graphbrain-contract/memory_runtime_api.py ──
// Principled memory lifecycle: every retrieve() call produces a WorkingMemoryState
// that is audited as an EpisodeBundle in HellGraph. This replaces ad-hoc context
// string concatenation with a tracked, replayable memory operation.

interface WorkingMemoryState {
  memory_id: string
  query: string
  policy_mode: string
  phase: string
  active_graph_neighborhood: string[]   // FeatureAtom ids from atoms pattern
  active_vector_neighborhood: string[]  // reserved for future embedding search
  query_reformulations: string[]        // keywords extracted from query
  top_k_documents: string[]             // source ids from graph pattern
  top_k_edges: string[]                 // COOCCURS_WITH / RELATED_TO expansions
  top_k_hyperedges: string[]            // reserved for hyperedge lift
  retrieval_path: Array<{ pattern: string; durationMs: number; hits: number }>
  channel: string
  ttl_seconds: number
  created_at: string
}

// ─── Public types ─────────────────────────────────────────────────────────────

export type RetrievalPattern = 'graph' | 'temporal' | 'sparql' | 'cache-augmented' | 'atoms' | 'beliefs' | 'cairnpath' | 'study-brain' | 'ops-brain' | 'hipporag'

export interface RetrievedContext {
  text: string
  sources: Array<{ id: string; label: string; score: number }>
  patterns: RetrievalPattern[]
  tokenEstimate: number
  workingMemory?: WorkingMemoryState
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function retrieve(
  query: string,
  opts?: {
    patterns?: RetrievalPattern[]
    workspaceId?: string
    sessionId?: string
    maxTokens?: number
    conversationId?: string
  },
): Promise<RetrievedContext> {
  const patterns: RetrievalPattern[] = opts?.patterns ?? ['beliefs', 'atoms', 'graph', 'temporal', 'cache-augmented', 'hipporag']
  const maxChars = (opts?.maxTokens ?? 2000) * 4  // ~4 chars per token

  // Extract keywords for WorkingMemoryState.query_reformulations
  const STOP = new Set(['with','that','this','from','have','will','been','were','they','them',
    'what','when','where','which','your','about','like','just','know','some'])
  const queryKeywords = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length >= 4 && !STOP.has(w)).slice(0, 8)

  const memoryId = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const retrievalPath: WorkingMemoryState['retrieval_path'] = []

  type PatternResult = { text: string; sources: Array<{ id: string; label: string; score: number }> }

  // Per-pattern budgets: fast in-memory patterns (beliefs, cache-augmented) get tight
  // timeouts to avoid blocking on degenerate graph sizes; BFS-heavy patterns get more.
  const PATTERN_TIMEOUT_MS: Record<RetrievalPattern, number> = {
    'beliefs':         150,
    'cache-augmented': 100,
    'atoms':           900,
    'graph':           800,
    'temporal':        600,
    'sparql':          700,
    'cairnpath':       900,
    'study-brain':     3500,   // embeds the query + cosine over the OCW brain (disk-cached after first hit)
    'ops-brain':       1500,   // lexical scan over the ops corpus (no embed call — fast, disk-cached)
    'hipporag':        700,    // personalized-PageRank associative recall (HippoRAG) over the clean graph
  }

  const timeout = <T>(ms: number, p: Promise<T>): Promise<T | null> =>
    Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])

  const tasks: Array<Promise<PatternResult | null>> = patterns.map((pattern) => {
    const start = Date.now()
    let inner: Promise<PatternResult>
    switch (pattern) {
      case 'graph':        inner = runGraphPattern(query); break
      case 'temporal':     inner = runTemporalPattern(query); break
      case 'sparql':       inner = runSparqlPattern(query, opts?.sessionId); break
      case 'atoms':        inner = runAtomsPattern(query); break
      case 'cairnpath':    inner = runCairnPathPattern(query); break
      case 'study-brain':  inner = runStudyBrainPattern(query); break
      case 'ops-brain':    inner = runOpsBrainPattern(query); break
      case 'beliefs':      inner = runBeliefsPattern(); break
      case 'hipporag':     inner = runHippoRagPattern(query); break
      case 'cache-augmented': inner = runCacheAugmentedPattern(opts?.sessionId ?? opts?.workspaceId ?? 'default'); break
      default:             return Promise.resolve(null)
    }
    const ms = PATTERN_TIMEOUT_MS[pattern] ?? 500
    return timeout(ms, inner.then(r => {
      retrievalPath.push({ pattern, durationMs: Date.now() - start, hits: r.sources.length })
      return r
    }))
  })

  const results = await Promise.all(tasks)

  const timedOut = results.filter(r => r === null).length
  if (timedOut === patterns.length && patterns.length > 0) {
    console.warn(`[retrieval] All ${patterns.length} patterns timed out for query: "${logSafe(query)}"`)
  }

  const usedPatterns: RetrievalPattern[] = []
  const allSources: Array<{ id: string; label: string; score: number }> = []
  const parts: string[] = []
  let totalChars = 0

  // Holistic re-ranking: order pattern results by their BEST source score so the highest-
  // quality grounding survives the char budget. Was fixed pattern-order — a weak pattern
  // (beliefs/cache) hitting the budget first truncated the strong ones (atoms/graph-search).
  const ranked = results
    .map((result, i) => ({ result, pattern: patterns[i]!, best: Math.max(0, ...(result?.sources ?? []).map((s) => s.score)) }))
    .filter((r) => Boolean(r.result?.text?.trim()))
    .sort((a, b) => b.best - a.best)

  for (const { result, pattern } of ranked) {
    if (!result) continue
    const chunk = result.text.trim()
    if (totalChars + chunk.length > maxChars) {
      const remaining = maxChars - totalChars
      if (remaining > 0) { parts.push(chunk.slice(0, remaining)); totalChars += remaining; usedPatterns.push(pattern); allSources.push(...result.sources) }
      break
    }
    parts.push(chunk)
    totalChars += chunk.length
    usedPatterns.push(pattern)
    allSources.push(...result.sources)
  }

  const text = parts.join('\n\n')
  const deduped = dedupeSources(allSources)

  // Build WorkingMemoryState — principled memory lifecycle record
  const atomsResult = results[patterns.indexOf('atoms')]
  const graphResult = results[patterns.indexOf('graph')]
  const workingMemory: WorkingMemoryState = {
    memory_id: memoryId,
    query,
    policy_mode: 'retrieval',
    phase: 'completed',
    active_graph_neighborhood: (atomsResult?.sources ?? []).map(s => s.id).slice(0, 20),
    active_vector_neighborhood: [],
    query_reformulations: queryKeywords,
    top_k_documents: (graphResult?.sources ?? []).map(s => s.id).slice(0, 10),
    top_k_edges: deduped.filter(s => s.label !== 'WorkspacePrefix').map(s => s.id).slice(0, 20),
    top_k_hyperedges: [],
    retrieval_path: retrievalPath,
    channel: opts?.sessionId ?? opts?.workspaceId ?? 'default',
    ttl_seconds: 3600,
    created_at: createdAt,
  }

  // Emit EpisodeBundle to HellGraph as an audit trail — fire-and-forget
  if (opts?.conversationId || opts?.sessionId) {
    const episodeHash = crypto.createHash('sha1').update(memoryId).digest('hex').slice(0, 12)
    try {
      ingestInteraction({
        runId: `episode:${episodeHash}`,
        sessionId: opts.sessionId ?? 'unknown',
        modelRouted: 'retrieval',
        provider: 'hellgraph',
        promptSummary: query.slice(0, 280),
        responseSummary: `patterns:${usedPatterns.join(',')} sources:${deduped.length}`,
        evidenceHash: episodeHash,
        policyAdmitted: true,
        latencyMs: retrievalPath.reduce((s, p) => s + p.durationMs, 0),
        timestamp: createdAt,
      })
    } catch { /* graph unavailable — skip audit */ }
  }

  return {
    text,
    sources: deduped,
    patterns: usedPatterns,
    tokenEstimate: Math.ceil(text.length / 4),
    workingMemory,
  }
}

// ─── Pattern implementations ──────────────────────────────────────────────────

async function runGraphPattern(
  query: string,
): Promise<{ text: string; sources: Array<{ id: string; label: string; score: number }> }> {
  const g = getGraph()
  // Use the real graph search (cosine + Jaccard + link expansion) instead of capitalized-word
  // regex + flat-0.7 BFS — the agent now grounds with the SAME search the UI uses, scored.
  const { graphSearch } = await import('./graph-search.js')
  const store = {
    nodesByLabel: (l: string) => g.nodesByLabel(l) as Array<{ id: string; labels: string[]; properties: Record<string, unknown> }>,
    out: (id: string, e?: string) => g.out(id, e) as Array<{ id: string; labels: string[]; properties: Record<string, unknown> }>,
    in: (id: string, e?: string) => g.in(id, e) as Array<{ id: string; labels: string[]; properties: Record<string, unknown> }>,
  }
  // Best-effort query embedding → cosine over atoms that carry vectors (lexical + link still
  // work without it).
  let queryVector: number[] | undefined
  try {
    const { embedBatchLocal } = await import('./embed-runtime.js')
    const v = await embedBatchLocal([query]); const vec = v?.[0]; if (vec) queryVector = vec
  } catch { /* cosine optional */ }
  const vectorOf = (n: { properties: Record<string, unknown> }) => {
    const raw = n.properties['embedding']; if (!raw) return null
    try { return typeof raw === 'string' ? JSON.parse(raw) as number[] : (raw as number[]) } catch { return null }
  }

  const all = graphSearch(store, query, { limit: 30, ...(queryVector ? { queryVector, vectorOf } : {}) })
  // Dedupe by surface form (the store has lexical-variant atoms) — keep the highest-scored.
  const bySurface = new Map<string, typeof all[number]>()
  for (const h of all) { const k = h.surface.toLowerCase(); const p = bySurface.get(k); if (!p || p.score < h.score) bySurface.set(k, h) }
  const hits = [...bySurface.values()].sort((a, b) => b.score - a.score).slice(0, 15)
  if (hits.length === 0) return { text: '', sources: [] }

  const SNIPPET_PROPS = ['promptSummary', 'responseSummary', 'content', 'text']
  const lines: string[] = []
  const sources = hits.map((h) => {
    const n = g.getNode(h.id)
    let snippet = h.surface
    for (const prop of SNIPPET_PROPS) {
      const val = n?.properties?.[prop]
      if (typeof val === 'string' && val.length > 0) { snippet = val.slice(0, 180); break }
    }
    lines.push(`• ${h.surface} (${h.via} ${h.score})${snippet !== h.surface ? `: ${snippet}` : ''}`)
    return { id: h.id, label: h.label, score: h.score }
  })
  return { text: `### Graph Context\n${lines.join('\n')}`, sources }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function runTemporalPattern(
  query: string,
): Promise<{ text: string; sources: Array<{ id: string; label: string; score: number }> }> {
  // Extract keywords for SPARQL FILTER (push down into graph layer, not post-hoc JS)
  const STOP = new Set(['with', 'that', 'this', 'from', 'have', 'will', 'been', 'were', 'they', 'them', 'what', 'when', 'where', 'which', 'your', 'about'])
  const keywords = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .slice(0, 5)  // keep FILTER clause compact

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Build FILTER: always restrict to 7-day window; add keyword regex when terms exist
  const dateFilter = `?ts >= "${sevenDaysAgo}"`
  const kwFilter = keywords.length > 0
    ? ` && (${keywords.map(kw => `regex(?content, "${escapeRegex(kw)}", "i")`).join(' || ')})`
    : ''
  const filterClause = `FILTER(${dateFilter}${kwFilter})`

  let result
  try {
    result = graphSparql(`
      SELECT ?msg ?content ?role ?ts WHERE {
        ?msg <rdf:type> <Message> .
        ?msg <content> ?content .
        ?msg <role> ?role .
        ?msg <createdAt> ?ts .
        ${filterClause}
      }
      ORDER BY DESC(?ts) LIMIT 15
    `)
  } catch {
    return { text: '', sources: [] }
  }

  const lines: string[] = []
  const sources: Array<{ id: string; label: string; score: number }> = []

  for (const binding of result.bindings) {
    const content = String(binding.content ?? '')
    const role = String(binding.role ?? '')
    const msgId = String(binding.msg ?? '')
    const ts = String(binding.ts ?? '')
    // Score by how many keywords matched (SPARQL already filtered to at least 1)
    const lc = content.toLowerCase()
    const matchCount = keywords.length > 0
      ? keywords.filter((kw) => lc.includes(kw)).length
      : 1
    lines.push(`[${ts}] ${role}: ${content.slice(0, 200)}`)
    sources.push({ id: msgId, label: 'Message', score: Math.min(1, 0.5 + matchCount * 0.1) })
  }

  return {
    text: lines.length > 0 ? `### Recent Messages\n${lines.join('\n')}` : '',
    sources,
  }
}

async function runSparqlPattern(
  query: string,
  sessionId?: string,
): Promise<{ text: string; sources: Array<{ id: string; label: string; score: number }> }> {
  if (!sessionId) return { text: '', sources: [] }
  // SECURITY: sessionId is user-controlled (url.searchParams) and interpolated into the SPARQL query
  // literal below — reject anything but a safe id charset so a quote can't rewrite the query.
  if (!isSafeSessionId(sessionId)) return { text: '', sources: [] }

  let result
  try {
    result = graphSparql(`
      SELECT ?interaction ?promptSummary ?responseSummary ?ts WHERE {
        ?session <sessionId> "${sessionId}" .
        ?session <HAS_INTERACTION> ?interaction .
        ?interaction <promptSummary> ?promptSummary .
        ?interaction <responseSummary> ?responseSummary .
        ?interaction <timestamp> ?ts .
      }
      ORDER BY DESC(?ts) LIMIT 10
    `)
  } catch {
    return { text: '', sources: [] }
  }

  const summaries = result.bindings.map((b) => {
    const prompt = String(b.promptSummary ?? '').slice(0, 120)
    const response = String(b.responseSummary ?? '').slice(0, 120)
    return `${prompt} → ${response}`
  })

  if (summaries.length === 0) return { text: '', sources: [] }

  const sources = result.bindings.map((b) => ({
    id: String(b.interaction ?? ''),
    label: 'Interaction',
    score: 0.6,
  }))

  return {
    text: `### Session Interactions\n${summaries.join('\n')}`,
    sources,
  }
}

async function runCacheAugmentedPattern(
  sessionId: string,
): Promise<{ text: string; sources: Array<{ id: string; label: string; score: number }> }> {
  const wp = buildWorkspacePrefix(sessionId)
  return {
    text: wp.prefix,
    sources: [{ id: `session:${sessionId}`, label: 'WorkspacePrefix', score: 1.0 }],
  }
}

// ─── Atom pattern — cross-session FEATURE_ATOM recall ────────────────────────
// Searches all FeatureAtom nodes (extracted entities from past conversations)
// for keyword overlap with the current query. This is the core cross-session
// memory recall: Noetica remembers what you've talked about before.

const ATOM_STOP = new Set([
  'with','that','this','from','have','will','been','were','they','them',
  'what','when','where','which','your','about','like','just','know','some',
  'make','more','time','than','into','then','also','very','much','only',
  'even','back','well','here','been','such','most','over','same','after',
])

// HippoRAG: query entities seed a personalized-PageRank walk over the clean knowledge graph, surfacing
// ASSOCIATIVELY related concepts the lexical/atom patterns miss (the "neurobiologically-inspired" recall).
async function runHippoRagPattern(query: string): Promise<{ text: string; sources: Array<{ id: string; label: string; score: number }> }> {
  const [{ associativeRetrieve }, { cleanLabel }] = await Promise.all([import('./graph-ppr.js'), import('./graph-surface.js')])
  const g = getGraph()
  const labelById = new Map<string, string>()
  const nodes: Array<{ id: string }> = []
  for (const n of g.allNodes()) {
    const l = cleanLabel(n as never)
    if (!l) continue
    labelById.set(n.id, l); nodes.push({ id: n.id })
  }
  if (nodes.length < 3) return { text: '', sources: [] }
  const edges = g.allEdges().map((e) => ({ from: e.from, to: e.to }))
  const { results } = associativeRetrieve(nodes, edges, labelById, query, { topK: 8 })
  if (!results.length) return { text: '', sources: [] }
  const text = `Associatively related (HippoRAG / personalized PageRank): ${results.map((r) => r.label).join(', ')}.`
  return { text, sources: results.map((r) => ({ id: r.id, label: r.label, score: Number(r.score.toFixed(4)) })) }
}

async function runAtomsPattern(
  query: string,
): Promise<{ text: string; sources: Array<{ id: string; label: string; score: number }> }> {
  const g = getGraph()

  const queryTokens = new Set(
    query.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !ATOM_STOP.has(w)),
  )

  if (queryTokens.size === 0) return { text: '', sources: [] }

  const atoms = g.allNodes().filter((n) => n.labels.includes('FeatureAtom') && n.properties['shacl_quarantined'] !== 'true')
  if (atoms.length === 0) return { text: '', sources: [] }

  const scored: Scored[] = []

  for (const atom of atoms) {
    const norm = String(atom.properties['normalised'] ?? '').toLowerCase()
    if (!norm || norm.length < 3) continue

    const atomTokens = norm.split(/[\s\-_]+/).filter((w) => w.length >= 3)

    // Token intersection
    const exactMatches = atomTokens.filter((t) => queryTokens.has(t)).length
    // Substring containment (query token appears anywhere in the atom surface)
    const substrMatches = [...queryTokens].filter((t) => norm.includes(t)).length

    const rawScore = (exactMatches * 1.0 + substrMatches * 0.4) / queryTokens.size
    if (rawScore > 0) {
      // Boost by ECAN STI — atoms the graph has been "thinking about" recently rank higher
      const sti = stiNorm(atom.id)
      scored.push({ node: atom, score: Math.min(rawScore * (1 + sti * 0.5), 1) })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  // MMR reranking: take top-20 candidates and apply Maximum Marginal Relevance
  // to eliminate redundant atoms while maximising query coverage.
  // Uses Jaccard similarity of token sets as the redundancy signal (zero dependencies).
  const top = mmrRerank(scored.slice(0, 20), 12)

  const lines: string[] = []
  const sources: Array<{ id: string; label: string; score: number }> = []

  for (const { node, score } of top) {
    const surface = String(node.properties['surface'] ?? node.id)
    const kind = String(node.properties['kind'] ?? 'FEATURE_ATOM')
    const primes = String(node.properties['prime_support'] ?? '')
    const primesTag = primes ? ` [${primes}]` : ''
    const conf = String(node.properties['confidence'] ?? '')
    const confTag = conf ? ` (conf ${Number(conf).toFixed(2)})` : ''
    lines.push(`• ${surface}  ${kind}${primesTag}${confTag}`)
    sources.push({ id: node.id, label: kind, score })
  }

  // Expand via pattern matcher: find neighbors connected by COOCCURS_WITH or RELATED_TO
  // These are entities that co-occurred or were semantically related in past interactions.
  const as = g.atomspace()
  const seen = new Set(top.map(({ node }) => node.id))
  const neighborLines: string[] = []
  const neighborSources: Array<{ id: string; label: string; score: number }> = []

  for (const { node } of top.slice(0, 5)) {
    for (const edgeLabel of ['COOCCURS_WITH', 'RELATED_TO'] as const) {
      const pat: Pattern = {
        clauses: [
          L('EvaluationLink',
            N('PredicateNode', edgeLabel),
            L('ListLink', N('ConceptNode', node.id), V('neighbor'))
          ),
        ],
        select: ['neighbor'],
      }
      try {
        const result = findMatches(as, pat)
        for (const grounding of result.groundings) {
          const h = grounding['neighbor']
          if (!h) continue
          const nAtom = as.getAtom(h)
          if (!nAtom?.name || seen.has(nAtom.name)) continue
          seen.add(nAtom.name)
          const nNode = g.getNode(nAtom.name)
          if (!nNode?.labels.includes('FeatureAtom')) continue
          const surface = String(nNode.properties['surface'] ?? nNode.id)
          const kind = String(nNode.properties['kind'] ?? 'FEATURE_ATOM')
          const primes = String(nNode.properties['prime_support'] ?? '')
          const primesTag = primes ? ` [${primes}]` : ''
          neighborLines.push(`• ${surface}  ${kind}${primesTag} ← ${edgeLabel}`)
          neighborSources.push({ id: nNode.id, label: kind, score: 0.5 })
          if (neighborLines.length >= 10) break
        }
      } catch { /* skip if pattern matcher unavailable */ }
      if (neighborLines.length >= 10) break
    }
    if (neighborLines.length >= 10) break
  }

  const allLines = [...lines, ...(neighborLines.length > 0 ? ['', '  Related:'] : []), ...neighborLines]

  return {
    text: `### Known Entities (from memory)\n${allLines.join('\n')}`,
    sources: [...sources, ...neighborSources],
  }
}

// ─── CairnPath pattern — entity retrieval via the CairnPath traversal protocol ─
// Seeds from query-matched FeatureAtoms, then runs the CairnPath
// EXPAND → DEDUP → RANK(ecan_sti) → CAP invariant to gather the attention-ranked
// neighborhood. Same engine as the /api/cairnpath routes — makes the protocol
// load-bearing in normal chat (gated by NOETICA_CAIRNPATH_RETRIEVAL in server.ts).
async function runCairnPathPattern(
  query: string,
): Promise<{ text: string; sources: Array<{ id: string; label: string; score: number }> }> {
  const g = getGraph()
  const as = g.atomspace()

  const queryTokens = new Set(
    query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((w) => w.length >= 3 && !ATOM_STOP.has(w)),
  )
  if (queryTokens.size === 0) return { text: '', sources: [] }

  const atoms = g.allNodes().filter((n) => n.labels.includes('FeatureAtom') && n.properties['shacl_quarantined'] !== 'true')
  if (atoms.length === 0) return { text: '', sources: [] }

  // Seed selection: same surface-token matching as the atoms pattern.
  const seeds: Array<{ id: string; score: number }> = []
  for (const atom of atoms) {
    const norm = String(atom.properties['normalised'] ?? '').toLowerCase()
    if (!norm || norm.length < 3) continue
    const atomTokens = norm.split(/[\s\-_]+/).filter((w) => w.length >= 3)
    const exact = atomTokens.filter((t) => queryTokens.has(t)).length
    const substr = [...queryTokens].filter((t) => norm.includes(t)).length
    const raw = (exact * 1.0 + substr * 0.4) / queryTokens.size
    if (raw > 0) seeds.push({ id: atom.id, score: Math.min(raw * (1 + stiNorm(atom.id) * 0.5), 1) })
  }
  if (seeds.length === 0) return { text: '', sources: [] }
  seeds.sort((a, b) => b.score - a.score)

  // Resolve seed concept nodes to AtomSpace handles, then run the CairnPath invariant.
  const seedHandles = seeds.slice(0, 8)
    .map((s) => as.getNode('ConceptNode', s.id)?.handle)
    .filter((h): h is string => Boolean(h))
  if (seedHandles.length === 0) return { text: '', sources: [] }

  const { handles, metrics } = cairnPathExpand(as, seedHandles, 15)

  const lines: string[] = []
  const sources: Array<{ id: string; label: string; score: number }> = []
  const seen = new Set<string>()
  // Score expanded neighbors by descending rank position (CairnPath returns ranked order).
  handles.forEach((h, idx) => {
    const atom = as.getAtom(h)
    const name = atom?.name
    if (!name || seen.has(name)) return
    seen.add(name)
    const node = g.getNode(name)
    if (!node?.labels.includes('FeatureAtom')) return
    const surface = String(node.properties['surface'] ?? node.id)
    const kind = String(node.properties['kind'] ?? 'FEATURE_ATOM')
    const score = Math.max(0.3, 1 - idx / Math.max(handles.length, 1))
    lines.push(`• ${surface}  ${kind}`)
    sources.push({ id: node.id, label: kind, score })
  })

  if (lines.length === 0) return { text: '', sources: [] }
  return {
    text: `### CairnPath neighborhood (EXPAND→DEDUP→RANK→CAP, fanout ${metrics.fanout})\n${lines.join('\n')}`,
    sources,
  }
}

// ─── Belief pattern — inject Michael's current belief state into chat context ─
// Queries the most recent BeliefSnapshot from HellGraph (written by the GAIA
// superconscious loop). This is the digital twin's world model entering chat:
// "Michael is currently focused on X, believes Y with 80% confidence".

async function runBeliefsPattern(): Promise<{ text: string; sources: Array<{ id: string; label: string; score: number }> }> {
  const g = getGraph()
  const beliefs = g.allNodes()
    .filter((n) => n.labels.includes('BeliefSnapshot'))
    .sort((a, b) => String(b.properties['created_at'] ?? b.properties['captured_at'] ?? '').localeCompare(
      String(a.properties['created_at'] ?? a.properties['captured_at'] ?? ''),
    ))
    .slice(0, 1)

  if (beliefs.length === 0) return { text: '', sources: [] }

  const belief = beliefs[0]!
  const lines: string[] = []
  const focus   = String(belief.properties['current_focus'] ?? '').trim()
  const summary = String(belief.properties['world_summary'] ?? belief.properties['summary'] ?? '').trim()

  if (focus)   lines.push(`Current focus: ${focus}`)
  if (summary) lines.push(`World state: ${summary}`)

  try {
    const atoms = JSON.parse(String(belief.properties['posterior_atoms'] ?? '[]')) as Array<{ claim: string; weight: number }>
    for (const a of atoms.slice(0, 5)) {
      lines.push(`• (${Math.round(a.weight * 100)}%) ${a.claim}`)
    }
  } catch { /* malformed JSON — skip */ }

  if (lines.length === 0) return { text: '', sources: [] }

  return {
    text: `### Michael's Belief State\n${lines.join('\n')}`,
    sources: [{ id: belief.id, label: 'BeliefSnapshot', score: 0.95 }],
  }
}

// ─── study-brain — OCW knowledge retrieval (the MMLU stack, finally in the lanes) ──
// Grounds STEM/knowledge questions on the MIT-OpenCourseWare brain the benchmark proved
// works (lib/study-brain.ts). The intent-router routes explain_teach / qa_over_doc /
// compare_benchmark / research_lookup here. No-op (empty, fast) when the brain is absent,
// so non-STEM deployments fall through to the HellGraph patterns unchanged.
// Promoted from the MMLU board (2026-06-23): the two mechanisms that beat baseline and GENERALIZE to chat.
//   qgen / HyDE (+4.3): expand the query with a hypothetical answer passage so retrieval matches the
//     document's vocabulary, not just the question's.
//   gate / CRAG (+4.3): when the model is already confident, ground only on STRONG evidence (don't inject
//     mediocre context into a question it knows — the saturated-bio failure); ground readily when unsure.
// Both come from ONE LLM call (generate the passage; prefix UNSURE if not confident), so the promotion adds
// a single round-trip, is fault-tolerant (any failure → prior behaviour), and is env-disablable.
const HYDE_ON = process.env['NOETICA_HYDE'] !== '0'
const RETRIEVAL_GATE_ON = process.env['NOETICA_RETRIEVAL_GATE'] !== '0'
const PROMOTE_MODEL = process.env['NOETICA_CHAT_MODEL'] || process.env['NOETICA_MODEL'] || 'qwen2.5:7b'

async function runStudyBrainPattern(
  query: string,
): Promise<{ text: string; sources: Array<{ id: string; label: string; score: number }> }> {
  if (!studyBrainReady()) return { text: '', sources: [] }
  // qgen + gate in a single call: ask for the HyDE passage and a confidence signal at once.
  const extraQueries: string[] = []
  let bar = 0.30 // retrieval-strength floor — below this it's noise; grounding on noise is the RAFT failure.
  if (HYDE_ON || RETRIEVAL_GATE_ON) {
    try {
      const { content } = await generateOllamaText({
        model: PROMOTE_MODEL, temperature: 0.3, numCtx: 2048,
        messages: [{ role: 'user', content: `In 2-3 sentences, state the facts, definitions, or laws needed to answer the question below, the way a textbook would — assert the knowledge directly, do NOT mention the question. If you are not confident in these facts, begin your reply with "UNSURE: ".\n\nQuestion: ${query}` }],
      })
      const raw = content.replace(/\s+/g, ' ').trim()
      const unsure = /^unsure\b[:\s]/i.test(raw)
      const passage = raw.replace(/^unsure\b[:\s]*/i, '').trim()
      if (HYDE_ON && passage.length > 20) extraQueries.push(passage.slice(0, 600))
      if (RETRIEVAL_GATE_ON && !unsure) bar = 0.45 // confident → raise the bar: ground only on STRONG evidence
    } catch { /* HyDE/gate are best-effort — fall back to the literal query + default bar */ }
  }
  const hits = await studyBrainRetrieve(query, [], 6, extraQueries)
  // Only surface confidently-relevant chunks — below the bar it's noise, and grounding
  // on noise is worse than not grounding (the RAFT failure mode).
  const good = hits.filter((h) => h.score >= bar)
  if (good.length === 0) return { text: '', sources: [] }
  const lines = good.map((h, i) => `[${i + 1}] (${h.field}) ${h.text.replace(/\s+/g, ' ').trim()}`)
  return {
    text: `### MIT-OpenCourseWare context\n${lines.join('\n\n')}`,
    sources: good.map((h) => ({ id: `ocw:${h.field}/${h.slug}`, label: h.field, score: h.score })),
  }
}

// Grounds OPERATIONAL questions (commands, runbooks, manpages) on the ops brain (lib/ops-brain.ts) —
// a SEPARATE store from the academic brain and the chat atomspace, so the three never cross-pollute.
// Lexical (no embed call). No-op (empty, fast) when the ops corpus is absent, so a deployment without
// it falls through unchanged.
async function runOpsBrainPattern(
  query: string,
): Promise<{ text: string; sources: Array<{ id: string; label: string; score: number }> }> {
  if (!opsBrainReady()) return { text: '', sources: [] }
  const hits = opsBrainRetrieve(query, 6)
  // Require real lexical overlap — below ~0.15 coverage it's an incidental token match, not relevance.
  const good = hits.filter((h) => h.score >= 0.15)
  if (good.length === 0) return { text: '', sources: [] }
  const lines = good.map((h, i) => `[${i + 1}] (${h.subject}${h.section ? `(${h.section})` : ''}) ${h.text.replace(/\s+/g, ' ').trim()}`)
  return {
    text: `### Operations knowledge\n${lines.join('\n\n')}`,
    sources: good.map((h) => ({ id: `ops:${h.subject}`, label: h.subject || 'ops', score: h.score })),
  }
}

// ─── MMR reranking — Maximum Marginal Relevance ───────────────────────────────
// Greedily selects up to `k` candidates that maximise coverage and minimise
// redundancy. Uses Jaccard token overlap as the similarity proxy (zero deps).
// lambda: weight given to relevance vs diversity (0.7 = 70% relevance, 30% novelty).

type Scored = { node: { id: string; properties: Record<string, unknown>; labels: string[] }; score: number }

function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3))
}

function jaccardSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const t of a) if (b.has(t)) intersection++
  return intersection / (a.size + b.size - intersection)
}

function mmrRerank(candidates: Scored[], k: number, lambda = 0.7): Scored[] {
  if (candidates.length === 0) return []
  if (candidates.length <= k) return candidates

  const tokenSets = candidates.map(({ node }) =>
    tokenize(String(node.properties['normalised'] ?? node.properties['surface'] ?? node.id)),
  )

  const selected: number[] = []
  const remaining = candidates.map((_, i) => i)

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0
    let bestMMR = -Infinity
    for (let ri = 0; ri < remaining.length; ri++) {
      const ci = remaining[ri]!
      const rel = candidates[ci]!.score
      const maxSim = selected.length === 0
        ? 0
        : Math.max(...selected.map((si) => jaccardSim(tokenSets[ci]!, tokenSets[si]!)))
      const mmr = lambda * rel - (1 - lambda) * maxSim
      if (mmr > bestMMR) { bestMMR = mmr; bestIdx = ri }
    }
    selected.push(remaining[bestIdx]!)
    remaining.splice(bestIdx, 1)
  }

  return selected.map((i) => candidates[i]!)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dedupeSources(
  sources: Array<{ id: string; label: string; score: number }>,
): Array<{ id: string; label: string; score: number }> {
  // Keep the HIGHEST score when an atom surfaces in multiple patterns (was first-seen, which
  // could keep a lower score), then return highest-first.
  const best = new Map<string, { id: string; label: string; score: number }>()
  for (const s of sources) { const p = best.get(s.id); if (!p || p.score < s.score) best.set(s.id, s) }
  return [...best.values()].sort((a, b) => b.score - a.score)
}
