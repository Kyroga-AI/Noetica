import type { MemoryEntry, MemoryStore } from './types'
import { cosineSimilarity, keywordScore } from './embeddings'

export function addEntry(store: MemoryStore, entry: Omit<MemoryEntry, 'id' | 'created_at'>): MemoryStore {
  const newEntry: MemoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
  }
  return { ...store, entries: [...store.entries, newEntry] }
}

export function removeEntry(store: MemoryStore, id: string): MemoryStore {
  return { ...store, entries: store.entries.filter((e) => e.id !== id) }
}

export function updateEntry(store: MemoryStore, id: string, patch: Partial<Pick<MemoryEntry, 'text' | 'tags' | 'embedding'>>): MemoryStore {
  return {
    ...store,
    entries: store.entries.map((e) => e.id === id ? { ...e, ...patch } : e),
  }
}

export function sortedEntries(store: MemoryStore): MemoryEntry[] {
  return [...store.entries].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

// Build a system prompt block from memories — injected at conversation start.
// Pass `relevant` to inject only a curated subset (semantic retrieval result).
export function buildMemoryContext(store: MemoryStore, relevant?: MemoryEntry[]): string | null {
  const entries = relevant ?? sortedEntries(store)
  if (entries.length === 0) return null
  const lines = entries.map((e) => `- ${e.text}`)
  return `## What you know about the user\n\n${lines.join('\n')}`
}

// Score and rank entries by semantic similarity to a query.
// Uses cosine similarity when embeddings are available, keyword scoring otherwise.
export function searchEntries(
  query: string,
  entries: MemoryEntry[],
  k: number,
  queryEmbedding?: number[],
): MemoryEntry[] {
  if (entries.length === 0) return []

  const scored = entries.map((e) => {
    let score: number
    if (queryEmbedding && e.embedding) {
      score = cosineSimilarity(queryEmbedding, e.embedding)
    } else {
      score = keywordScore(query, `${e.text} ${e.tags.join(' ')}`)
    }
    return { entry: e, score }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => s.entry)
}

// Heuristic: extract memory-worthy statements from an assistant response.
// Returns candidate strings for the user to approve.
export function extractMemoryCandidates(assistantContent: string): string[] {
  const candidates: string[] = []

  // Look for explicit memory markers the model might emit
  const markerRe = /\[REMEMBER:\s*(.+?)\]/gi
  let m: RegExpExecArray | null
  while ((m = markerRe.exec(assistantContent)) !== null) {
    if (m[1]) candidates.push(m[1].trim())
  }

  return candidates
}
