'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Workroom, WorkroomMessage, WorkroomStore, AgentDispatch } from '@/lib/types/workroom'
import { WORKROOM_STORE_VERSION } from '@/lib/types/workroom'
import { loadWorkroomStore, saveWorkroomStore } from '@/lib/workrooms/storage'

export interface UseWorkroomsReturn {
  hydrated: boolean
  workrooms: Workroom[]
  createWorkroom: (name: string, description?: string) => Workroom
  updateWorkroom: (id: string, patch: Partial<Pick<Workroom, 'name' | 'description' | 'pinned'>>) => void
  deleteWorkroom: (id: string) => void
  appendMessage: (id: string, msg: WorkroomMessage) => void
  updateMessage: (workroomId: string, msgId: string, patch: Partial<WorkroomMessage>) => void
  updateDispatch: (workroomId: string, dispatch: AgentDispatch) => void
}

export function useWorkrooms(): UseWorkroomsReturn {
  const [hydrated, setHydrated] = useState(false)
  const [store, setStore] = useState<WorkroomStore>({ workrooms: {}, version: WORKROOM_STORE_VERSION })
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    loadWorkroomStore().then((s) => {
      if (!cancelled) { setStore(s); setHydrated(true) }
    })
    return () => { cancelled = true }
  }, [])

  function scheduleSave(next: WorkroomStore) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveWorkroomStore(next).catch(() => {/* ignore */})
    }, 600)
  }

  function mutate(updater: (s: WorkroomStore) => WorkroomStore) {
    setStore((cur) => {
      const next = updater(cur)
      scheduleSave(next)
      return next
    })
  }

  const createWorkroom = useCallback((name: string, description = ''): Workroom => {
    const now = new Date().toISOString()
    const room: Workroom = {
      id: crypto.randomUUID(),
      name: name.trim() || 'New workroom',
      description,
      participants: [
        { id: 'user', name: 'You', kind: 'human', joinedAt: now },
      ],
      messages: [
        {
          id: crypto.randomUUID(),
          participantId: 'system',
          participantName: 'Noetica',
          participantKind: 'system',
          kind: 'system',
          content: `Workroom "${name.trim() || 'New workroom'}" created. Add agents and start collaborating.`,
          createdAt: now,
        },
      ],
      dispatches: [],
      createdAt: now,
      updatedAt: now,
    }
    mutate((s) => ({ ...s, workrooms: { ...s.workrooms, [room.id]: room } }))
    return room
  }, [])

  const updateWorkroom = useCallback((id: string, patch: Partial<Pick<Workroom, 'name' | 'description' | 'pinned'>>) => {
    mutate((s) => {
      const r = s.workrooms[id]
      if (!r) return s
      return { ...s, workrooms: { ...s.workrooms, [id]: { ...r, ...patch, updatedAt: new Date().toISOString() } } }
    })
  }, [])

  const deleteWorkroom = useCallback((id: string) => {
    mutate((s) => {
      const { [id]: _, ...rest } = s.workrooms
      return { ...s, workrooms: rest }
    })
  }, [])

  const appendMessage = useCallback((id: string, msg: WorkroomMessage) => {
    mutate((s) => {
      const r = s.workrooms[id]
      if (!r) return s
      return {
        ...s,
        workrooms: {
          ...s.workrooms,
          [id]: { ...r, messages: [...r.messages, msg], updatedAt: new Date().toISOString() },
        },
      }
    })
  }, [])

  const updateMessage = useCallback((workroomId: string, msgId: string, patch: Partial<WorkroomMessage>) => {
    mutate((s) => {
      const r = s.workrooms[workroomId]
      if (!r) return s
      const messages = r.messages.map((m) => m.id === msgId ? { ...m, ...patch } : m)
      return { ...s, workrooms: { ...s.workrooms, [workroomId]: { ...r, messages, updatedAt: new Date().toISOString() } } }
    })
  }, [])

  const updateDispatch = useCallback((workroomId: string, dispatch: AgentDispatch) => {
    mutate((s) => {
      const r = s.workrooms[workroomId]
      if (!r) return s
      const dispatches = r.dispatches.some((d) => d.id === dispatch.id)
        ? r.dispatches.map((d) => d.id === dispatch.id ? dispatch : d)
        : [...r.dispatches, dispatch]
      return { ...s, workrooms: { ...s.workrooms, [workroomId]: { ...r, dispatches, updatedAt: new Date().toISOString() } } }
    })
  }, [])

  const workrooms = Object.values(store.workrooms).sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return b.updatedAt.localeCompare(a.updatedAt)
  })

  return { hydrated, workrooms, createWorkroom, updateWorkroom, deleteWorkroom, appendMessage, updateMessage, updateDispatch }
}
