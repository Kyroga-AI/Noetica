'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@/lib/types/message'
import type { ActiveSurface } from '@/lib/types/surface'
import type { WorkspaceMode } from '@/components/chat/InputArea'
import type { SessionStore, WorkspaceSession } from './types'
import { loadSessionStore, saveSessionStore } from './storage'
import {
  emptyStore, createSession, updateSession,
  deleteSession, setActiveSession, sortedSessions,
  ephemeralStamp, purgeExpiredEphemeral, obliterateAllEphemeral,
} from './manager'
import { publishOpenChat, revokeOpenChat, type PublishResult } from './commons-client'

const SAVE_DEBOUNCE_MS = 800
const REAPER_INTERVAL_MS = 15_000  // check for expired ephemeral sessions every 15s

export function useSession(defaultModelId: string, opts?: { ephemeralTtlMinutes?: number | null }) {
  const [store, setStore] = useState<SessionStore>(emptyStore)
  const [hydrated, setHydrated] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Latest ephemeral TTL, read inside callbacks/intervals without re-subscribing.
  const ttlRef = useRef<number | null>(opts?.ephemeralTtlMinutes ?? null)
  ttlRef.current = opts?.ephemeralTtlMinutes ?? null

  // Load on mount — and immediately purge anything that already expired while away.
  useEffect(() => {
    loadSessionStore().then((loaded) => {
      if (loaded && Object.keys(loaded.sessions).length > 0) {
        const { store: purged, removed } = purgeExpiredEphemeral(loaded, Date.now())
        if (removed.length > 0) saveSessionStore(purged)
        setStore(purged)
      }
      setHydrated(true)
    })
  }, [])

  // Flush to disk WITHOUT debounce — used when obliterating so removal is durable now.
  const persistNow = useCallback((next: SessionStore) => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    void saveSessionStore(next)
  }, [])

  // Debounced persist
  const persist = useCallback((next: SessionStore) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveSessionStore(next), SAVE_DEBOUNCE_MS)
  }, [])

  function mutate(next: SessionStore) { setStore(next); persist(next) }

  // Flush-on-quit: the debounced save can be lost if the app closes within the debounce
  // window — a real cause of "my chats didn't save". On pagehide / beforeunload / tab-hide
  // (and on unmount), synchronously flush the latest store so nothing in flight is dropped.
  const storeRef = useRef(store)
  storeRef.current = store
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
      void saveSessionStore(storeRef.current)   // localStorage path is synchronous → persists before quit
    }
    const onVis = () => { if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVis)
      flush()
    }
  }, [])

  // Reaper: obliterate ephemeral sessions whose sliding window has passed.
  useEffect(() => {
    const tick = () => {
      setStore((cur) => {
        const { store: purged, removed } = purgeExpiredEphemeral(cur, Date.now())
        if (removed.length > 0) persistNow(purged)
        return removed.length > 0 ? purged : cur
      })
    }
    const h = setInterval(tick, REAPER_INTERVAL_MS)
    return () => clearInterval(h)
  }, [persistNow])

  const activeSession: WorkspaceSession | null =
    store.activeSessionId ? (store.sessions[store.activeSessionId] ?? null) : null

  const newSession = useCallback(
    (opts: { surface: ActiveSurface; workspaceMode: WorkspaceMode; messages?: ChatMessage[]; title?: string; parentId?: string }) => {
      const { store: next, session } = createSession(store, { ...opts, modelId: defaultModelId, ephemeralTtlMinutes: ttlRef.current })
      mutate(next)
      return session
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, defaultModelId]
  )

  const switchSession = useCallback(
    (id: string) => mutate(setActiveSession(store, id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store]
  )

  const removeSession = useCallback(
    (id: string) => mutate(deleteSession(store, id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store]
  )

  const updateMessages = useCallback(
    (messages: ChatMessage[]) => {
      if (!store.activeSessionId) return
      // While armed, every new message slides the obliteration window forward.
      const stamp = ephemeralStamp(ttlRef.current, Date.now())
      mutate(updateSession(store, store.activeSessionId, { messages, ...stamp }))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store]
  )

  // Panic / disarm: obliterate every ephemeral session right now, durably.
  const obliterateNow = useCallback(() => {
    setStore((cur) => {
      const { store: next, removed } = obliterateAllEphemeral(cur)
      if (removed.length > 0) persistNow(next)
      return removed.length > 0 ? next : cur
    })
  }, [persistNow])

  const updateSurface = useCallback(
    (surface: ActiveSurface, workspaceMode: WorkspaceMode) => {
      if (!store.activeSessionId) return
      mutate(updateSession(store, store.activeSessionId, { surface, workspaceMode }))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store]
  )

  const updateModelId = useCallback(
    (modelId: string) => {
      if (!store.activeSessionId) return
      mutate(updateSession(store, store.activeSessionId, { modelId }))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store]
  )

  const updateTitle = useCallback(
    (title: string) => {
      if (!store.activeSessionId) return
      mutate(updateSession(store, store.activeSessionId, { title }))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store]
  )

  // Open-chat commons toggle. 'open' PUBLISHES the chat (server runs the mandatory PII gate) and only flips the
  // visibility bit if publish succeeds — a refused publish (gate failed, ephemeral) leaves the chat private and
  // returns the reason for the UI. 'private' REVOKES immediately (removed from the commons index) then flips back.
  const setSessionVisibility = useCallback(
    async (id: string, visibility: 'private' | 'open'): Promise<PublishResult> => {
      const s = store.sessions[id]
      if (!s) return { ok: false, error: 'no such session' }
      if (visibility === 'open') {
        if (s.ephemeral) return { ok: false, error: 'ephemeral (security-lane) chats cannot be opened' }
        const r = await publishOpenChat(s)
        if (!r.ok) return r   // do NOT mark open if the server refused to index
        mutate(updateSession(store, id, { visibility: 'open' }))
        return r
      }
      await revokeOpenChat(id)
      mutate(updateSession(store, id, { visibility: 'private' }))
      return { ok: true }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store]
  )

  return {
    hydrated,
    store,
    activeSession,
    sessions: sortedSessions(store),
    newSession,
    switchSession,
    removeSession,
    updateMessages,
    updateSurface,
    updateModelId,
    updateTitle,
    setSessionVisibility,
    obliterateNow,
  }
}
