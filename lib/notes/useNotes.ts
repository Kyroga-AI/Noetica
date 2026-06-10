'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Note, NoteStore } from '@/lib/types/note'
import { NOTE_STORE_VERSION, MAX_NOTES } from '@/lib/types/note'
import type { ChatMessage } from '@/lib/types/message'
import { loadNoteStore, saveNoteStore } from '@/lib/notes/storage'

export interface UseNotesReturn {
  hydrated: boolean
  notes: Note[]
  createNote: (partial?: Partial<Pick<Note, 'title' | 'body' | 'tags'>>) => Note
  updateNote: (id: string, patch: Partial<Omit<Note, 'id' | 'createdAt'>>) => void
  deleteNote: (id: string) => void
  appendMessages: (id: string, msgs: ChatMessage[]) => void
  pinNote: (id: string, pinned: boolean) => void
}

export function useNotes(): UseNotesReturn {
  const [hydrated, setHydrated] = useState(false)
  const [store, setStore] = useState<NoteStore>({ notes: {}, version: NOTE_STORE_VERSION })
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    loadNoteStore().then((s) => {
      if (!cancelled) { setStore(s); setHydrated(true) }
    })
    return () => { cancelled = true }
  }, [])

  function scheduleSave(next: NoteStore) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveNoteStore(next).catch(() => {/* ignore */})
    }, 600)
  }

  function mutate(updater: (s: NoteStore) => NoteStore) {
    setStore((current) => {
      const next = updater(current)
      scheduleSave(next)
      return next
    })
  }

  const createNote = useCallback((partial?: Partial<Pick<Note, 'title' | 'body' | 'tags'>>): Note => {
    const now = new Date().toISOString()
    const note: Note = {
      id: crypto.randomUUID(),
      title: partial?.title ?? 'Untitled note',
      body: partial?.body ?? '',
      tags: partial?.tags ?? [],
      messages: [],
      createdAt: now,
      updatedAt: now,
    }
    mutate((s) => {
      const entries = Object.values(s.notes)
      if (entries.length >= MAX_NOTES) {
        const oldest = entries
          .filter((n) => !n.pinned)
          .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0]
        if (oldest) {
          const { [oldest.id]: _, ...rest } = s.notes
          return { ...s, notes: { ...rest, [note.id]: note } }
        }
      }
      return { ...s, notes: { ...s.notes, [note.id]: note } }
    })
    return note
  }, [])

  const updateNote = useCallback((id: string, patch: Partial<Omit<Note, 'id' | 'createdAt'>>) => {
    mutate((s) => {
      const existing = s.notes[id]
      if (!existing) return s
      return {
        ...s,
        notes: {
          ...s.notes,
          [id]: { ...existing, ...patch, updatedAt: new Date().toISOString() },
        },
      }
    })
  }, [])

  const deleteNote = useCallback((id: string) => {
    mutate((s) => {
      const { [id]: _, ...rest } = s.notes
      return { ...s, notes: rest }
    })
  }, [])

  const appendMessages = useCallback((id: string, msgs: ChatMessage[]) => {
    mutate((s) => {
      const existing = s.notes[id]
      if (!existing) return s
      return {
        ...s,
        notes: {
          ...s.notes,
          [id]: {
            ...existing,
            messages: [...existing.messages, ...msgs],
            updatedAt: new Date().toISOString(),
          },
        },
      }
    })
  }, [])

  const pinNote = useCallback((id: string, pinned: boolean) => {
    updateNote(id, { pinned })
  }, [updateNote])

  const notes = Object.values(store.notes).sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return b.updatedAt.localeCompare(a.updatedAt)
  })

  return { hydrated, notes, createNote, updateNote, deleteNote, appendMessages, pinNote }
}
