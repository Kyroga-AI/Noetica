'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Artifact, ArtifactStore, ArtifactType } from '@/lib/types/artifact'
import { ARTIFACT_STORE_VERSION } from '@/lib/types/artifact'
import { loadArtifactStore, saveArtifactStore } from './storage'

const SAVE_DEBOUNCE_MS = 600

function emptyStore(): ArtifactStore {
  return { artifacts: {}, version: ARTIFACT_STORE_VERSION }
}

export function useArtifacts() {
  const [store, setStore] = useState<ArtifactStore>(emptyStore)
  const [hydrated, setHydrated] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const loaded = loadArtifactStore()
    if (loaded) setStore(loaded)
    setHydrated(true)
  }, [])

  const persist = useCallback((next: ArtifactStore) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveArtifactStore(next), SAVE_DEBOUNCE_MS)
  }, [])

  function mutate(next: ArtifactStore) { setStore(next); persist(next) }

  const createArtifact = useCallback((
    opts: Omit<Artifact, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'tags'> & Partial<Pick<Artifact, 'status' | 'tags'>>
  ): Artifact => {
    const artifact: Artifact = {
      ...opts,
      id: crypto.randomUUID(),
      status: opts.status ?? 'draft',
      tags: opts.tags ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    mutate({ ...store, artifacts: { ...store.artifacts, [artifact.id]: artifact } })
    return artifact
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  const updateArtifact = useCallback((id: string, patch: Partial<Omit<Artifact, 'id' | 'createdAt'>>) => {
    const existing = store.artifacts[id]
    if (!existing) return
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() }
    mutate({ ...store, artifacts: { ...store.artifacts, [id]: updated } })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  const deleteArtifact = useCallback((id: string) => {
    const artifacts = { ...store.artifacts }
    delete artifacts[id]
    mutate({ ...store, artifacts })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  const sortedArtifacts = Object.values(store.artifacts)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const byType = (type: ArtifactType) => sortedArtifacts.filter((a) => a.type === type)

  return { hydrated, artifacts: sortedArtifacts, byType, createArtifact, updateArtifact, deleteArtifact }
}
