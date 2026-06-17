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
import { findMatches, V, N, L } from '../../lib/hellgraph/patternMatcher.js'
import type { Pattern } from '../../lib/hellgraph/patternMatcher.js'
import type { PropertyValue } from '../../lib/hellgraph/types.js'

// ─── Public types ─────────────────────────────────────────────────────────────

export type RetrievalPattern = 'graph' | 'temporal' | 'sparql' | 'cache-augmented' | 'atoms'

export interface RetrievedContext {
  text: string
  sources: Array<{ id: string; label: string; score: number }>
  patterns: RetrievalPattern[]
  tokenEstimate: number
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
  const patterns: RetrievalPattern[] = opts?.patterns ?? ['atoms', 'graph', 'temporal', 'cache-augmented']
  const maxChars = (opts?.maxTokens ?? 2000) * 4  // ~4 chars per token

  // Run all patterns with a shared 500 ms timeout
  type PatternResult = { text: string; sources: Array<{ id: string; label: string; score: number }> }

  const timeout = <T>(ms: number, p: Promise<T>): Promise<T | null> =>
    Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])

  const tasks: Promise<PatternResult | null>[] = patterns.map((pattern) => {
    switch (pattern) {
      case 'graph':
        return timeout(500, runGraphPattern(query))
      case 'temporal':
        return timeout(500, runTemporalPattern(query))
      case 'sparql':
        return timeout(500, runSparqlPattern(query, opts?.sessionId))
      case 'atoms':
        return timeout(500, runAtomsPattern(query))
      case 'cache-augmented':
        return timeout(500, runCacheAugmentedPattern(opts?.sessionId ?? opts?.workspaceId ?? 'default'))
      default:
        return Promise.resolve(null)
    }
  })

  const results = await Promise.all(tasks)

  // Concatenate results up to maxChars, tracking sources
  const usedPatterns: RetrievalPattern[] = []
  const allSources: Array<{ id: string; label: string; score: number }> = []
  const parts: string[] = []
  let totalChars = 0

  for (let i = 0; i < patterns.length; i++) {
    const result = results[i]
    if (!result || !result.text) continue

    const chunk = result.text.trim()
    if (!chunk) continue

    if (totalChars + chunk.length > maxChars) {
      // Include truncated chunk up to the limit
      const remaining = maxChars - totalChars
      if (remaining > 0) {
        parts.push(chunk.slice(0, remaining))
        totalChars += remaining
        usedPatterns.push(patterns[i])
        allSources.push(...result.sources)
      }
      break
    }

    parts.push(chunk)
    totalChars += chunk.length
    usedPatterns.push(patterns[i])
    allSources.push(...result.sources)
  }

  const text = parts.join('\n\n')
  return {
    text,
    sources: dedupeSources(allSources),
    patterns: usedPatterns,
    tokenEstimate: Math.ceil(text.length / 4),
  }
}

// ─── Pattern implementations ──────────────────────────────────────────────────

async function runGraphPattern(
  query: string,
): Promise<{ text: string; sources: Array<{ id: string; label: string; score: number }> }> {
  const g = getGraph()

  // Extract capitalized words/phrases and quoted strings from query
  const entities: string[] = []

  // Quoted strings
  const quotedRe = /"([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = quotedRe.exec(query)) !== null) {
    if (m[1]) entities.push(m[1])
  }

  // Capitalized multi-word phrases (2+ consecutive capitalized words)
  const capPhraseRe = /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)\b/g
  while ((m = capPhraseRe.exec(query)) !== null) {
    if (m[1]) entities.push(m[1])
  }

  // Single capitalized words
  const singleCapRe = /\b([A-Z][a-zA-Z]{2,})\b/g
  while ((m = singleCapRe.exec(query)) !== null) {
    if (m[1] && !entities.includes(m[1])) entities.push(m[1])
  }

  if (entities.length === 0) {
    return { text: '', sources: [] }
  }

  const lines: string[] = []
  const sources: Array<{ id: string; label: string; score: number }> = []
  const seen = new Set<string>()

  const SNIPPET_PROPS = ['promptSummary', 'responseSummary', 'content', 'text']

  for (const entity of entities.slice(0, 8)) {
    const adjacent = [...g.out(entity), ...g.in(entity)]
    for (const node of adjacent) {
      if (seen.has(node.id)) continue
      seen.add(node.id)

      let snippet: string | null = null
      for (const prop of SNIPPET_PROPS) {
        const val = node.properties[prop]
        if (val && typeof val === 'string' && val.length > 0) {
          snippet = val.slice(0, 200)
          break
        }
      }
      if (!snippet) continue

      const shortId = node.id.length > 32 ? node.id.slice(-24) : node.id
      const label = node.labels[0] ?? 'node'
      lines.push(`• [${shortId}]: ${snippet}`)
      sources.push({ id: node.id, label, score: 0.7 })
    }
  }

  return {
    text: lines.length > 0 ? `### Graph Context\n${lines.join('\n')}` : '',
    sources,
  }
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

  const atoms = g.allNodes().filter((n) => n.labels.includes('FeatureAtom'))
  if (atoms.length === 0) return { text: '', sources: [] }

  type Scored = { node: typeof atoms[0]; score: number }
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
    if (rawScore > 0) scored.push({ node: atom, score: Math.min(rawScore, 1) })
  }

  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, 12)
  if (top.length === 0) return { text: '', sources: [] }

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dedupeSources(
  sources: Array<{ id: string; label: string; score: number }>,
): Array<{ id: string; label: string; score: number }> {
  const seen = new Set<string>()
  return sources.filter(({ id }) => {
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}
