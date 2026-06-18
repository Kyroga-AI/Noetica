'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MemoryEntry, MemoryStore } from './types'
import { emptyMemoryStore, loadMemoryStore, saveMemoryStore } from './storage'
import { addEntry, removeEntry, updateEntry, sortedEntries, buildMemoryContext, searchEntries } from './manager'
import { fetchEmbedding, fetchEmbeddings } from './embeddings'

const SAVE_DEBOUNCE_MS = 600

export function useMemory() {
  const [store, setStore] = useState<MemoryStore>(emptyMemoryStore())
  const [hydrated, setHydrated] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    loadMemoryStore().then((loaded) => {
      setStore(loaded)
      setHydrated(true)
    })
  }, [])

  const persist = useCallback((next: MemoryStore) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void saveMemoryStore(next), SAVE_DEBOUNCE_MS)
  }, [])

  function mutate(next: MemoryStore) { setStore(next); persist(next) }

  const remember = useCallback((text: string, opts?: { tags?: string[]; sessionId?: string; source?: MemoryEntry['source'] }) => {
    setStore((current) => {
      const next = addEntry(current, {
        text,
        tags: opts?.tags ?? [],
        session_id: opts?.sessionId,
        source: opts?.source ?? 'user',
      })
      persist(next)
      return next
    })
  }, [persist])

  const forget = useCallback((id: string) => {
    setStore((current) => { const next = removeEntry(current, id); persist(next); return next })
  }, [persist])

  const edit = useCallback((id: string, text: string, tags?: string[]) => {
    setStore((current) => { const next = updateEntry(current, id, { text, tags }); persist(next); return next })
  }, [persist])

  // Compute embedding for a single entry and persist it.
  // openaiKey optional — the embed route falls back to a local model when absent.
  const embedEntry = useCallback(async (id: string, openaiKey?: string): Promise<void> => {
    const entry = store.entries.find((e) => e.id === id)
    if (!entry || entry.embedding) return
    const embedding = await fetchEmbedding(entry.text, openaiKey)
    if (!embedding) return
    setStore((current) => {
      const next = updateEntry(current, id, { embedding })
      persist(next)
      return next
    })
  }, [store.entries, persist])

  // Compute embeddings for all entries missing one — batch request
  const embedAll = useCallback(async (openaiKey?: string): Promise<{ embedded: number; failed: number }> => {
    const missing = store.entries.filter((e) => !e.embedding)
    if (missing.length === 0) return { embedded: 0, failed: 0 }
    const texts = missing.map((e) => e.text)
    const embeddings = await fetchEmbeddings(texts, openaiKey)
    if (!embeddings) return { embedded: 0, failed: missing.length }
    setStore((current) => {
      let next = current
      for (let i = 0; i < missing.length; i++) {
        if (embeddings[i]) {
          next = updateEntry(next, missing[i].id, { embedding: embeddings[i] })
        }
      }
      persist(next)
      return next
    })
    return { embedded: embeddings.filter(Boolean).length, failed: embeddings.filter((e) => !e).length }
  }, [store.entries, persist])

  // Semantic search — uses cosine similarity if embeddings available, keyword fallback otherwise
  const search = useCallback(async (
    query: string,
    k = 10,
    openaiKey?: string,
  ): Promise<MemoryEntry[]> => {
    const all = sortedEntries(store)
    if (all.length === 0) return []
    let queryEmbedding: number[] | undefined
    // Embed the query whenever any entry has an embedding — the route uses the
    // local model when no key is given, so semantic search works offline too.
    if (all.some((e) => e.embedding)) {
      const emb = await fetchEmbedding(query, openaiKey)
      if (emb) queryEmbedding = emb
    }
    const results = searchEntries(query, all, k, queryEmbedding)
    // Fall back to all entries if nothing scored (preserves existing behavior)
    return results.length > 0 ? results : all.slice(0, k)
  }, [store])

  // Remove entries older than retentionDays — call once after settings are known
  const purgeExpired = useCallback((retentionDays: number) => {
    if (retentionDays <= 0) return
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString()
    setStore((current) => {
      const filtered = current.entries.filter((e) => e.created_at >= cutoff)
      if (filtered.length === current.entries.length) return current
      const next = { ...current, entries: filtered }
      persist(next)
      return next
    })
  }, [persist])

  const entries = sortedEntries(store)
  const memoryContext = buildMemoryContext(store)
  const embeddedCount = entries.filter((e) => e.embedding).length

  return { hydrated, entries, memoryContext, embeddedCount, remember, forget, edit, embedEntry, embedAll, search, purgeExpired }
}
