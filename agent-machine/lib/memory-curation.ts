/**
 * memory-curation — surface the user's memories in the graph and let them curate which
 * ones get injected into the LONG-TERM BRAIN.
 *
 * Memories from the `remember` tool persist as Document atoms with a `memory/<kind>-…`
 * filename (via ingestDocument), so today they're buried in the document lens with no
 * curation. This module:
 *   • listMemories  — the memory atoms as curatable records (kind, preview, pinned, LTI)
 *   • pinMemory     — boost the atom's LTI so it persists + surfaces (the "long-term brain";
 *                     LTI = long-term importance in ECAN — high-LTI atoms resist decay)
 *   • unpinMemory   — drop LTI back so it can decay out of the long-term set
 *
 * The user pins/unpins from the graph; pinning is literally raising the atom's standing in
 * the durable substrate. Pure over a minimal store (the real HellGraph store satisfies it).
 */

import { tokensOf, jaccard } from './graph-search.js'

export interface MemoryNode { id: string; labels: string[]; properties: Record<string, unknown> }
export interface MemoryStore {
  nodesByLabel(label: string): MemoryNode[]
  getNode(id: string): MemoryNode | null
  out(id: string, edgeLabel?: string): MemoryNode[]
  /** Persist a property change to the atom (projection mutation doesn't write back). */
  setProperty(id: string, key: string, value: unknown): void
  /** Boost/lower long-term importance on the underlying atom (the long-term brain). */
  setLti?(id: string, lti: number): void
}

export interface MemoryRecord {
  id: string
  kind: string            // preference | fact | identity | memory
  createdAt: string
  preview: string
  pinned: boolean
  lti: number
}

export const PINNED_LTI = 80    // pinned memories sit high in the long-term set
export const UNPINNED_LTI = 5

const isMemoryDoc = (n: MemoryNode): boolean =>
  (n.labels.includes('Document') || n.labels.includes('RECORD')) &&
  String(n.properties['filename'] ?? '').startsWith('memory/')

function kindOf(filename: string): string {
  const m = filename.replace(/^memory\//, '').match(/^(preference|fact|identity)\b/)
  return m ? m[1]! : 'memory'
}

/** Best-effort content preview for a memory: stored preview → a linked chunk's text → filename. */
function previewOf(store: MemoryStore, n: MemoryNode): string {
  const direct = String(n.properties['preview'] ?? n.properties['text'] ?? '').trim()
  if (direct) return direct.slice(0, 200)
  for (const nb of store.out(n.id)) {
    const t = String(nb.properties['text'] ?? '').trim()
    if ((nb.labels.includes('DocumentChunk') || nb.labels.includes('CHUNK')) && t) return t.slice(0, 200)
  }
  return String(n.properties['filename'] ?? n.id)
}

/** All (non-forgotten) memory atoms as curatable records, pinned-first then newest-first. */
export function listMemories(store: MemoryStore): MemoryRecord[] {
  const docs = store.nodesByLabel('Document').filter(isMemoryDoc).filter((n) => n.properties['deleted'] !== true)
  const recs = docs.map((n): MemoryRecord => ({
    id: n.id,
    kind: kindOf(String(n.properties['filename'] ?? '')),
    createdAt: String(n.properties['created_at'] ?? ''),
    preview: previewOf(store, n),
    pinned: n.properties['pinned'] === true,
    lti: Number(n.properties['lti'] ?? 0) || 0,
  }))
  return recs.sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || b.createdAt.localeCompare(a.createdAt))
}

function setPin(store: MemoryStore, id: string, pinned: boolean): boolean {
  const n = store.getNode(id)
  if (!n || !isMemoryDoc(n)) return false
  const lti = pinned ? PINNED_LTI : UNPINNED_LTI
  // Persist via setProperty (mutating the projection wouldn't write back to the atom).
  store.setProperty(id, 'pinned', pinned)
  store.setProperty(id, 'lti', lti)
  store.setProperty(id, 'curated_at', new Date().toISOString())
  store.setLti?.(id, lti)
  return true
}

/** Pin a memory into the long-term brain (raise LTI). */
export function pinMemory(store: MemoryStore, id: string): boolean { return setPin(store, id, true) }
/** Unpin a memory (lower LTI so it can decay out of the long-term set). */
export function unpinMemory(store: MemoryStore, id: string): boolean { return setPin(store, id, false) }

/** Forget a memory: soft-delete (the store is append-only) — excluded from recall + LTI dropped. */
export function forgetMemory(store: MemoryStore, id: string): boolean {
  const n = store.getNode(id)
  if (!n || !isMemoryDoc(n)) return false
  store.setProperty(id, 'deleted', true)
  store.setProperty(id, 'curated_at', new Date().toISOString())
  store.setLti?.(id, UNPINNED_LTI)
  return true
}

/** Find an existing memory whose preview is a near-duplicate of `content` (for dedup-on-write). */
export function findSimilarMemory(store: MemoryStore, content: string, threshold = 0.6): string | null {
  const qt = tokensOf(content)
  if (qt.size === 0) return null
  let best: { id: string; score: number } | null = null
  for (const m of listMemories(store)) {
    const score = jaccard(qt, tokensOf(m.preview))
    if (score >= threshold && (!best || score > best.score)) best = { id: m.id, score }
  }
  return best?.id ?? null
}

/**
 * Select the memories to inject for THIS turn — relevance-ranked, not a dump.
 *   • pinned memories are ALWAYS included (the user curated them = always honor)
 *   • unpinned memories surface only when relevant to the query (Jaccard over kind+preview),
 *     highest-scored first — so "what's the weather?" no longer drags in "prefers coffee"
 *   • if room remains and the query is empty/unmatched, fill with newest unpinned
 * Replaces listMemories(...).slice(0, n) at the injection site.
 */
export function selectRelevantMemories(store: MemoryStore, query: string, limit = 8): MemoryRecord[] {
  const all = listMemories(store)              // already pinned-first, newest-first
  const pinned = all.filter((m) => m.pinned)
  const unpinned = all.filter((m) => !m.pinned)
  const out: MemoryRecord[] = [...pinned]
  const qt = tokensOf(query)
  if (qt.size === 0) {
    for (const m of unpinned) { if (out.length >= limit) break; out.push(m) }   // no query → newest fill
  } else {
    const ranked = unpinned
      .map((m) => ({ m, score: jaccard(qt, tokensOf(`${m.kind} ${m.preview}`)) }))
      .filter((s) => s.score > 0)                                                // relevant ONLY — no irrelevant fill
      .sort((a, b) => b.score - a.score)
    for (const s of ranked) { if (out.length >= limit) break; out.push(s.m) }
  }
  return out.slice(0, limit)
}
