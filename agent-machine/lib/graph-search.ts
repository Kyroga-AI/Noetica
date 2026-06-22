/**
 * graph-search — fast topic/instance recall + discovery over the graph, fusing three
 * signals the user asked for:
 *   1. cosine     — similarity over topic/atom VECTORS (semantic alignment)
 *   2. Jaccard    — surface-form token overlap (instances, names, surface forms)
 *   3. link expansion — an instance LINKED to a matched atom inherits its relevance, so
 *      "a company on Hospital Way" surfaces for a search of "hospital" (the company atom is
 *      one hop from the matched 'hospital' term/topic).
 *
 * Pure + DI over a minimal store (the real HellGraph store satisfies it). Cosine is optional
 * (pass a query vector + a per-node vector accessor); without it, lexical + links still work.
 */

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'inc', 'llc', 'co', 'ltd', 'way', 'street', 'road', 'ave', 'avenue'])

export interface SearchNode { id: string; labels: string[]; properties: Record<string, unknown> }
export interface SearchStore {
  nodesByLabel(label: string): SearchNode[]
  out(id: string, edgeLabel?: string): SearchNode[]
  in(id: string, edgeLabel?: string): SearchNode[]
}

export interface SearchHit { id: string; label: string; surface: string; score: number; via: 'lexical' | 'cosine' | 'link' }
export interface SearchOpts {
  limit?: number
  labels?: string[]
  /** Embedding of the query, for cosine over atom vectors. */
  queryVector?: number[]
  /** Return a node's stored embedding, or null. */
  vectorOf?: (n: SearchNode) => number[] | null
}

const SEARCH_LABELS = ['FeatureAtom', 'Topic', 'GlossaryTerm', 'CanonicalEntity', 'Document']
const LINK_DECAY = 0.6

export function tokensOf(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)))
}
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}
export function cosineSim(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]! }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

/** The searchable surface text of an atom: surface forms, terms, names. */
function surfaceText(n: SearchNode): string {
  const p = n.properties
  return [p['surface'], p['normalised'], p['term'], p['name'], p['top_terms'], p['filename'], p['text']]
    .filter(Boolean).map(String).join(' ')
}
function bestSurface(n: SearchNode): string {
  const p = n.properties
  return String(p['surface'] ?? p['term'] ?? p['name'] ?? p['top_terms'] ?? p['filename'] ?? n.id).slice(0, 80)
}
const round = (x: number) => Number(x.toFixed(3))

/**
 * Search the graph for atoms aligned to the query by cosine + Jaccard, then expand one hop
 * along links so instances of a matched topic (and topics of a matched instance) surface too.
 */
export function graphSearch(store: SearchStore, query: string, opts: SearchOpts = {}): SearchHit[] {
  const k = opts.limit ?? 12
  const qTok = tokensOf(query)
  if (qTok.size === 0) return []

  // 1. Direct match: Jaccard over surface forms, blended with cosine when vectors exist.
  const hits = new Map<string, { node: SearchNode; score: number; via: SearchHit['via'] }>()
  for (const label of (opts.labels ?? SEARCH_LABELS)) {
    for (const n of store.nodesByLabel(label)) {
      const surf = surfaceText(n)
      if (!surf) continue
      const st = tokensOf(surf)
      let score = jaccard(qTok, st)
      let via: SearchHit['via'] = 'lexical'
      // containment bonus: a query token appearing inside a surface form (substring) still counts
      if (score === 0 && [...qTok].some((t) => surf.toLowerCase().includes(t))) score = 0.18
      if (opts.queryVector && opts.vectorOf) {
        const v = opts.vectorOf(n)
        if (v) { const cos = cosineSim(opts.queryVector, v); if (cos > score) { score = cos; via = 'cosine' } }
      }
      if (score > 0.05) {
        const prev = hits.get(n.id)
        if (!prev || prev.score < score) hits.set(n.id, { node: n, score, via })
      }
    }
  }

  // 2. Link expansion: a node one hop from a solid match inherits a decayed score. This is
  //    how "company on Hospital Way" surfaces for "hospital" — it's linked to the matched term.
  const seeds = [...hits.entries()].filter(([, h]) => h.score >= 0.15)
  for (const [id, h] of seeds) {
    for (const nb of [...store.out(id), ...store.in(id)]) {
      const linkScore = round(h.score * LINK_DECAY)
      const prev = hits.get(nb.id)
      if (!prev) hits.set(nb.id, { node: nb, score: linkScore, via: 'link' })
      else if (prev.via === 'link' && prev.score < linkScore) hits.set(nb.id, { node: nb, score: linkScore, via: 'link' })
    }
  }

  return [...hits.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((h) => ({ id: h.node.id, label: h.node.labels[0] ?? 'Atom', surface: bestSurface(h.node), score: round(h.score), via: h.via }))
}
