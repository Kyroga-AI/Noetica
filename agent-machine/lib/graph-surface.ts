/**
 * graph-surface — pure selection of a LEGIBLE, force-graph-ready subgraph from raw
 * HellGraph nodes/edges. Shared by the Next API route (web) and the agent-machine
 * backend route (Tauri desktop) so the two never drift. No imports — takes the node/
 * edge arrays as data, returns {nodes, links, total}.
 *
 * Lenses (`view`): `all` = a diverse named cross-section; `domain`/`document`/`chat` =
 * a CONNECTED subgraph BFS-walked along real edges from typed roots (or a `root` id).
 */

import type { GraphNode, GraphEdge } from '@socioprophet/hellgraph'
import { coreTokens, clusterByLexicalClosure } from './topic-closure.js'
import { isActionLabel } from './graph-hygiene.js'
import { dimensionOf } from './cskg.js'
type GNode = GraphNode
type GEdge = GraphEdge
export interface SurfaceNode { id: string; label: string; category: string; kind: string; kvClass: string; featured: boolean; degree: number }
export interface SurfaceLink { source: string; target: string; primary: boolean; epistemic: string; dimension: string }
export interface SurfaceResult { nodes: SurfaceNode[]; links: SurfaceLink[]; total: { nodes: number; edges: number } }

// Entity CLASS (regis-aligned) for an atom's primary label — what the node IS, for styling/legend/
// filtering. Coarser than the raw atom type so the legend stays legible.
export function kindOf(label: string): string {
  const l = (label ?? '').toLowerCase()
  if (isActionLabel(label ?? '')) return 'Action'   // verbs are their OWN class (filterable), not topics
  if (/cluster/.test(l)) return 'Cluster'
  if (/person|human|twin|user|persona|pseudonym/.test(l)) return 'Person'
  if (/org|company|institution|team/.test(l)) return 'Org'
  if (/session|turn|conversation|message|event|run|dispatch/.test(l)) return 'Session'
  if (/file|symbol|repo|code|module/.test(l)) return 'Code'
  if (/model|provider|tool|action|service|workload|app|device/.test(l)) return 'Service'
  if (/document|record|chunk|source|evidence|episode|proof/.test(l)) return 'Document'
  if (/domain|topic|glossary|concept|feature|vector|learningstate|candidate/.test(l)) return 'Concept'
  if (/entity|canonical|role|gaia|belief/.test(l)) return 'Entity'
  return 'Concept'
}
// Epistemic class of a relationship (regis edge typing): how much we should TRUST it. Algorithm/
// cluster-derived edges are 'inferred'; structural/ingested ones are 'extracted'.
export function epistemicOf(edgeKind: string): string {
  const k = (edgeKind ?? '').toLowerCase()
  if (/hygiene|match|merge|similar|cluster|infer|derive/.test(k)) return 'inferred'
  if (/has_|in_|contains|topic|term|symbol|chunk|cite|ref/.test(k)) return 'extracted'
  if (/confirm|attest|verified|consent|proof/.test(k)) return 'confirmed'
  return 'extracted'
}

// label → colour category (docs/learning/technical/trust/deployment palette)
export function categoryFor(label: string): string {
  const l = label.toLowerCase()
  const has = (...ks: string[]) => ks.some((k) => l.includes(k))
  if (has('topic', 'domain', 'glossary', 'concept', 'math', 'formula', 'function', 'variable', 'unit', 'physical', 'quantity', 'learningstate', 'academic', 'course')) return 'learning'
  if (has('document', 'chunk', 'record', 'source', 'evidence', 'episode', 'interaction', 'proof', 'semanticmemory', 'claim')) return 'docs'
  if (has('artifact', 'feature', 'vector', 'model', 'provider', 'repo', 'tool', 'action', 'candidate', 'checkpoint', 'attention', 'code', 'module')) return 'technical'
  if (has('entity', 'canonical', 'person', 'org', 'role', 'trust', 'attest', 'decision', 'ledger', 'concordance', 'remediation', 'shacl')) return 'trust'
  if (has('session', 'dispatch', 'event', 'run', 'self', 'loc')) return 'deployment'
  return 'other'
}

function isHashy(s: string): boolean {
  const t = s.trim()
  if (t.length < 2) return true
  const compact = t.replace(/[\s\-_]/g, '')
  if (/^[0-9a-f]{6,}$/i.test(compact)) return true
  const hex = (compact.match(/[0-9a-f]/gi) ?? []).length
  return compact.length >= 8 && hex / compact.length > 0.7
}
function isProse(s: string): boolean {
  if (/[#>]|\.\.\./.test(s)) return true
  if (/[.;:,]\s/.test(s)) return true
  if (s.trim().split(/\s+/).length > 4) return true
  return false
}
// Code / operator fragments that leak in as feature-atoms (") ==", "assert reverse_string(", "=> {"). They're
// not knowledge — drop them from every lens so the graph shows concepts, not parser crumbs.
function isSyntaxNoise(s: string): boolean {
  const t = s.trim()
  if (t.length < 2) return true
  const letters = (t.match(/[a-z]/gi) ?? []).length
  if (letters / t.length < 0.5) return true            // mostly operators/punctuation: ") ==", "=> {"
  if (/[({[]\s*$|^\s*[)}\]]/.test(t)) return true       // dangling bracket: "assert foo(", ") =="
  return false
}
// A label that's a path or carries operational stopwords (self/ntca, /tmp/ntca prbe,
// self notca md) should display as its core concept, not the raw path. Only rewrites such
// labels — a clean label (no path separator, no self/tmp/probe noise) is returned as-is.
function tidyTopicLabel(s: string): string {
  if (!/[/\\]/.test(s) && !/\b(self|tmp|probe|prbe)\b/i.test(s)) return s
  const core = coreTokens(s)                                   // splits on /\_-.:, drops stopwords + len<3
  if (core.length) return core.join(' ')
  return (s.split(/[/\\]/).pop() ?? s).trim()                 // fallback: basename
}

// Operational self-state / telemetry — written by the runtime (learning snapshots every 60s + per turn,
// attention values, session/self atoms), NOT knowledge. ~84% of the store is LearningState exhaust. Excluding
// it HERE (cleanLabel → null) de-pollutes every surface lens AND all ~16 analytics clean-set filters at once,
// since they all gate on `cleanLabel(n) !== null`.
const EXHAUST_LABELS = new Set(['LearningState', 'AttentionSnapshot', 'TrendSnapshot', 'Self', 'Session', 'Dispatch', 'RunEvent', 'WorkingMemoryState'])
export function isExhaust(n: GNode): boolean {
  const l = n.labels[0] ?? ''
  return EXHAUST_LABELS.has(l) || /noetica:learning:|:attention|trend-history|:self$|:session:/i.test(String(n.id))
}

// Document/memory/chat atoms encode their content in a path-shaped `filename` (memory/curation-<stamp>.md,
// chats/<title>.md) — the generic cleaner's isProse/isHashy guards reject these, so the whole "Memory" lens
// (view=document) returned 0 nodes. Derive a stable display title from the basename instead.
const DOC_KINDS = /^(Document|RECORD|Conversation|Message|SemanticMemoryRelease|SourceRecord|Episode)$/i
function docTitle(n: GNode): string | null {
  const raw = String(n.properties['title'] ?? n.properties['name'] ?? n.properties['filename'] ?? '')
  if (!raw) return null
  const base = (raw.split(/[/\\]/).pop() ?? raw)
    .replace(/\.[a-z0-9]{1,5}$/i, '')              // extension
    .replace(/[-_]?\d{8,}([-_].*)?$/, '')          // trailing date-stamp / hash tail
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return base.length > 1 && !isHashy(base) ? base.slice(0, 28) : null
}

export function cleanLabel(n: GNode): string | null {
  if (isExhaust(n)) return null
  if (DOC_KINDS.test(n.labels[0] ?? '')) { const t = docTitle(n); if (t) return t }
  for (const key of ['title', 'name', 'surface', 'normalised', 'filename']) {
    const v = n.properties[key]
    if (v == null) continue
    const cleaned = String(v)
      .replace(/\s+/g, ' ')
      .replace(/^\[[^\]]*\]\s*/, '')
      .replace(/\.(pdf|txt|md|json|vtt|srt|docx|pptx|xlsx|csv|html?|dmg|app|pkg|exe|zip|tar|gz)$/i, '')
      .replace(/^[#>.\-\s]+/, '')
      .trim()
    const s = tidyTopicLabel(cleaned)
    if (s && !isHashy(s) && !isProse(s) && !isSyntaxNoise(s)) return s.slice(0, 22)
  }
  const last = tidyTopicLabel((n.id.split(':').pop() ?? '').replace(/-[0-9a-f]{4,}$/i, '').replace(/-/g, ' ').trim())
  return last && !isHashy(last) && !isProse(last) && !isSyntaxNoise(last) ? last.slice(0, 22) : null
}

const VIEW_ROOTS: Record<string, (label: string) => boolean> = {
  tech: (l) => /^Code/.test(l),                                       // the "Tech" lens — OUR codebase (CodeModule + IMPORTS)
  domain: (l) => l === 'Domain' || l === 'Topic' || l === 'GlossaryTerm',
  document: (l) => DOC_KINDS.test(l),
  memory: (l) => DOC_KINDS.test(l),                                   // the "Memory" lens — docs + remembered facts
  chat: (l) => l === 'Conversation' || l === 'Message' || l.endsWith('Message'),
}

// Category lenses: show only nodes of one colour-category, ranked by degree. `tech` is
// the ecosystem (repos / models / providers / tools) — what "Sociosphere" should mean,
// not the memory-chunk soup of the document/chat lenses.
const CATEGORY_VIEWS: Record<string, string> = { knowledge: 'learning' }   // tech is now a CodeModule root-lens (VIEW_ROOTS), not an embedding cluster

export function selectSurface(allNodes: GNode[], allEdges: GEdge[], opts: { view?: string; limit?: number; root?: string } = {}): SurfaceResult {
  const limit = Math.min(120, Math.max(10, opts.limit ?? 34))
  const view = opts.view ?? 'all'
  const root = opts.root ?? ''

  const degree = new Map<string, number>()
  const adj = new Map<string, Set<string>>()
  for (const e of allEdges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
    ;(adj.get(e.from) ?? adj.set(e.from, new Set()).get(e.from)!).add(e.to)
    ;(adj.get(e.to) ?? adj.set(e.to, new Set()).get(e.to)!).add(e.from)
  }
  // Drop anything the hygiene pass marked pruned (junk classes) AND test-corpus pollution
  // (corpus-test-* atoms from graphbrain-bridge tests that leaked into the live graph — they
  // surface as duplicate/orphan "corpus test" nodes). `corpus-test` is a reserved test prefix.
  const labeled = allNodes.filter((n) =>
    cleanLabel(n) !== null && n.properties?.['hygiene_pruned'] !== true && !/corpus-test/i.test(String(n.id)))
  const byId = new Map(labeled.map((n) => [n.id, n]))

  let picked: GNode[]
  // Only resolve view→lens for an OWN key, so a crafted view ("constructor"/"__proto__")
  // can't select an inherited method that then gets invoked (js/unvalidated-dynamic-method-call).
  const catTarget = Object.prototype.hasOwnProperty.call(CATEGORY_VIEWS, view) ? CATEGORY_VIEWS[view] : undefined
  const rootMatch = Object.prototype.hasOwnProperty.call(VIEW_ROOTS, view) ? VIEW_ROOTS[view] : undefined
  if (catTarget) {
    // Drop tool-schema leaf atoms (parameter names) AND filesystem-path labels — both
    // are "technical" by type but noise in the ecosystem lens. Applied to both the
    // top-level list and the drill-down subtopics.
    const PARAM_NOISE = new Set(['name', 'arguments', 'path', 'content', 'query', 'input', 'output', 'type', 'properties', 'required', 'description', 'parameters', 'value', 'key', 'id', 'args', 'params', 'prompt', 'language'])
    const isClean = (n: GNode) => {
      const l = cleanLabel(n) ?? ''
      return l.length > 1 && !l.includes('/') && !/^[.~]/.test(l) && !PARAM_NOISE.has(l.toLowerCase())
    }
    if (root && byId.has(root)) {
      // Drill-down: a clicked topic → its connected (clean) subtopics (BFS from the root).
      const seen = new Set<string>([root])
      const queue: string[] = [root]
      while (queue.length && seen.size < limit) {
        const id = queue.shift()!
        for (const nb of adj.get(id) ?? []) {
          if (seen.size >= limit) break
          const nbNode = byId.get(nb)
          if (!seen.has(nb) && nbNode && isClean(nbNode)) { seen.add(nb); queue.push(nb) }
        }
      }
      picked = [...seen].map((id) => byId.get(id)!).filter(Boolean)
    } else {
      // Top-level: the highest-degree clean entities of this category. Drop orphans (degree 0)
      // — an isolated dot adds nothing to a relationship view (21% of atoms are orphans).
      picked = labeled
        .filter((n) => categoryFor(n.labels[0] ?? '') === catTarget)
        .filter(isClean)
        .filter((n) => (degree.get(n.id) ?? 0) > 0)
        .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
        .slice(0, limit)
    }
  } else if (rootMatch) {
    const roots = (root && byId.has(root) ? [byId.get(root)!] : labeled.filter((n) => rootMatch(n.labels[0] ?? '')))
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
    const seen = new Set<string>()
    const queue: string[] = []
    for (const r of roots) { if (seen.size >= limit) break; if (!seen.has(r.id)) { seen.add(r.id); queue.push(r.id) } }
    while (queue.length && seen.size < limit) {
      const id = queue.shift()!
      for (const nb of adj.get(id) ?? []) {
        if (seen.size >= limit) break
        if (!seen.has(nb) && byId.has(nb)) { seen.add(nb); queue.push(nb) }
      }
    }
    picked = [...seen].map((id) => byId.get(id)!).filter(Boolean)
  } else {
    const ranked = labeled.filter((n) => (degree.get(n.id) ?? 0) > 0)   // 'all' is a relationship view — drop orphans
      .slice().sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
    const byLabel = new Map<string, GNode[]>()
    for (const n of ranked) { const l = n.labels[0] ?? 'node'; const arr = byLabel.get(l); if (arr) arr.push(n); else byLabel.set(l, [n]) }
    // 'all' is a SUPERSET view — round-robin across kinds, but draw the meaningful kinds first (documents,
    // entities, glossary, concepts) and feature-atom/telemetry noise last, so the cross-section reads as real
    // knowledge rather than the highest-degree exhaust.
    const labelPriority = (l: string): number => {
      const x = l.toLowerCase()
      if (/document|conversation|message|record|episode/.test(x)) return 0
      if (/canonical|entity|person|org/.test(x)) return 1
      if (/glossary|domain|topic/.test(x)) return 2
      if (/concept|service|action/.test(x)) return 3
      if (/feature|learningstate|candidate|attention/.test(x)) return 6   // noise-prone → last
      return 4
    }
    const groups = [...byLabel.entries()].sort((a, b) => labelPriority(a[0]) - labelPriority(b[0])).map((e) => e[1])
    picked = []
    let progress = true
    while (picked.length < limit && progress) {
      progress = false
      for (const arr of groups) { const n = arr.shift(); if (n) { picked.push(n); progress = true; if (picked.length >= limit) break } }
    }
  }

  // Collapse lexical-duplicate nodes so the same concept isn't drawn several times
  // (corpus test ×2; noetica / notca / ntca → one). Keep the highest-degree node per cluster
  // as the representative and remap the others' edges onto it. Display-only — store untouched.
  const labelOf = new Map(picked.map((n) => [n.id, cleanLabel(n) ?? n.id]))
  const { canonicalOf } = clusterByLexicalClosure([...new Set(labelOf.values())])
  const repOf = new Map<string, GNode>()      // canonical label → representative node
  const remap = new Map<string, string>()     // node id → representative id
  for (const n of picked) {
    const canon = canonicalOf.get(labelOf.get(n.id)!) ?? labelOf.get(n.id)!
    const cur = repOf.get(canon)
    if (!cur) { repOf.set(canon, n); remap.set(n.id, n.id); continue }
    const keepN = (degree.get(n.id) ?? 0) > (degree.get(cur.id) ?? 0) ? n : cur
    const dropN = keepN === n ? cur : n
    repOf.set(canon, keepN)
    for (const [k, v] of remap) if (v === dropN.id) remap.set(k, keepN.id)
    remap.set(dropN.id, keepN.id); remap.set(keepN.id, keepN.id)
  }
  picked = [...repOf.values()]
  const rid = (id: string) => remap.get(id) ?? id

  const keep = new Set(picked.map((n) => n.id))
  const maxDeg = Math.max(1, ...picked.map((n) => degree.get(n.id) ?? 0))
  const nodes: SurfaceNode[] = picked.map((n) => {
    const lbl = n.labels[0] ?? 'node'
    const deg = degree.get(n.id) ?? 0
    // kvClass — the keyed-vec class (nearest MMLU/MMLU-Pro subject) is the DEFAULT class for grouping/
    // linking content: eval-anchored and shared with the canon + board. Falls back to the lexical colour-
    // category when a node has no keyed-vec class, so every node always carries a linking class.
    const kvProp = n.properties?.['kvClass']
    const kvClass = (typeof kvProp === 'string' && kvProp) ? kvProp : categoryFor(lbl)
    return { id: n.id, label: cleanLabel(n) ?? lbl, category: categoryFor(lbl), kind: kindOf(lbl), kvClass, featured: deg >= maxDeg * 0.6, degree: deg }
  })

  const shown = new Map<string, number>()
  const seenPair = new Set<string>()
  const CAP = 3
  const links: SurfaceLink[] = []
  for (const e of allEdges) {
    const from = rid(e.from), to = rid(e.to)          // remap onto cluster representatives
    if (!keep.has(from) || !keep.has(to) || from === to) continue
    const pair = from < to ? `${from}|${to}` : `${to}|${from}`
    if (seenPair.has(pair)) continue                  // dedupe parallel edges created by the collapse
    if ((shown.get(from) ?? 0) >= CAP || (shown.get(to) ?? 0) >= CAP) continue
    seenPair.add(pair)
    shown.set(from, (shown.get(from) ?? 0) + 1)
    shown.set(to, (shown.get(to) ?? 0) + 1)
    links.push({ source: from, target: to, primary: (degree.get(from) ?? 0) >= maxDeg * 0.6 || (degree.get(to) ?? 0) >= maxDeg * 0.6, epistemic: epistemicOf(e.label), dimension: dimensionOf(e.label) })
  }

  return { nodes, links, total: { nodes: allNodes.length, edges: allEdges.length } }
}
