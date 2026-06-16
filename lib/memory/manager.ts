import type { MemoryEntry, MemoryStore } from './types'

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

export function updateEntry(store: MemoryStore, id: string, patch: Partial<Pick<MemoryEntry, 'text' | 'tags'>>): MemoryStore {
  return {
    ...store,
    entries: store.entries.map((e) => e.id === id ? { ...e, ...patch } : e),
  }
}

export function sortedEntries(store: MemoryStore): MemoryEntry[] {
  return [...store.entries].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

// Build a system prompt block from all memories — injected at conversation start.
export function buildMemoryContext(store: MemoryStore): string | null {
  const entries = sortedEntries(store)
  if (entries.length === 0) return null
  const lines = entries.map((e) => `- ${e.text}`)
  return `## What you know about the user\n\n${lines.join('\n')}`
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
