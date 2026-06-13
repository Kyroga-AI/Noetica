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
} from './manager'

const SAVE_DEBOUNCE_MS = 800

export function useSession(defaultModelId: string) {
  const [store, setStore] = useState<SessionStore>(emptyStore)
  const [hydrated, setHydrated] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load on mount
  useEffect(() => {
    loadSessionStore().then((loaded) => {
      if (loaded && Object.keys(loaded.sessions).length > 0) setStore(loaded)
      setHydrated(true)
    })
  }, [])

  // Debounced persist
  const persist = useCallback((next: SessionStore) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveSessionStore(next), SAVE_DEBOUNCE_MS)
  }, [])

  function mutate(next: SessionStore) { setStore(next); persist(next) }

  const activeSession: WorkspaceSession | null =
    store.activeSessionId ? (store.sessions[store.activeSessionId] ?? null) : null

  const newSession = useCallback(
    (opts: { surface: ActiveSurface; workspaceMode: WorkspaceMode; messages?: ChatMessage[]; title?: string; parentId?: string }) => {
      const { store: next, session } = createSession(store, { ...opts, modelId: defaultModelId })
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
      mutate(updateSession(store, store.activeSessionId, { messages }))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store]
  )

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
  }
}
