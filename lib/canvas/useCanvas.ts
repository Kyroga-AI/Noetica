'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CanvasDocument, CanvasStore } from '@/lib/types/canvas'
import { CANVAS_STORE_VERSION, CANVAS_WRITE_EVENT } from '@/lib/types/canvas'
import { loadCanvasStore, saveCanvasStore } from './storage'

const SAVE_DEBOUNCE_MS = 500

function nowIso() { return new Date().toISOString() }

export function useCanvas() {
  const [store, setStore] = useState<CanvasStore>({ documents: {}, activeDocumentId: null, version: CANVAS_STORE_VERSION })
  const [hydrated, setHydrated] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Hydrate from localStorage on mount
  useEffect(() => {
    setStore(loadCanvasStore())
    setHydrated(true)
  }, [])

  // Listen for canvas_write events from the AI tool
  useEffect(() => {
    function onWrite(e: Event) {
      const { id, content, title } = (e as CustomEvent<{ id: string; content: string; title?: string }>).detail
      setStore((prev) => {
        const doc = prev.documents[id]
        if (!doc) return prev
        const updated = { ...doc, content, updatedAt: nowIso(), ...(title ? { title } : {}) }
        const next = { ...prev, documents: { ...prev.documents, [id]: updated } }
        saveCanvasStore(next)
        return next
      })
    }
    window.addEventListener(CANVAS_WRITE_EVENT, onWrite)
    return () => window.removeEventListener(CANVAS_WRITE_EVENT, onWrite)
  }, [])

  const persist = useCallback((next: CanvasStore) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveCanvasStore(next), SAVE_DEBOUNCE_MS)
  }, [])

  const documents = Object.values(store.documents).sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return b.updatedAt.localeCompare(a.updatedAt)
  })

  const activeDocument = store.activeDocumentId ? (store.documents[store.activeDocumentId] ?? null) : null

  function createDocument(title = 'Untitled canvas'): CanvasDocument {
    const doc: CanvasDocument = {
      id: crypto.randomUUID(),
      title,
      content: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    setStore((prev) => {
      const next = {
        ...prev,
        documents: { ...prev.documents, [doc.id]: doc },
        activeDocumentId: doc.id,
      }
      persist(next)
      return next
    })
    return doc
  }

  function updateDocument(id: string, patch: Partial<CanvasDocument>) {
    setStore((prev) => {
      const doc = prev.documents[id]
      if (!doc) return prev
      const updated = { ...doc, ...patch, updatedAt: nowIso() }
      const next = { ...prev, documents: { ...prev.documents, [id]: updated } }
      persist(next)
      return next
    })
  }

  function deleteDocument(id: string) {
    setStore((prev) => {
      const docs = { ...prev.documents }
      delete docs[id]
      const next: CanvasStore = {
        ...prev,
        documents: docs,
        activeDocumentId: prev.activeDocumentId === id ? (Object.keys(docs)[0] ?? null) : prev.activeDocumentId,
      }
      persist(next)
      return next
    })
  }

  function setActiveDocument(id: string | null) {
    setStore((prev) => {
      const next = { ...prev, activeDocumentId: id }
      persist(next)
      return next
    })
  }

  function pinDocument(id: string, pinned: boolean) {
    updateDocument(id, { pinned })
  }

  return { hydrated, documents, activeDocument, activeDocumentId: store.activeDocumentId, createDocument, updateDocument, deleteDocument, setActiveDocument, pinDocument }
}
