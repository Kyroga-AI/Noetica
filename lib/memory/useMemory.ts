'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MemoryEntry, MemoryStore } from './types'
import { emptyMemoryStore, loadMemoryStore, saveMemoryStore } from './storage'
import { addEntry, removeEntry, updateEntry, sortedEntries, buildMemoryContext } from './manager'

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

  const entries = sortedEntries(store)
  const memoryContext = buildMemoryContext(store)

  return { hydrated, entries, memoryContext, remember, forget, edit }
}
