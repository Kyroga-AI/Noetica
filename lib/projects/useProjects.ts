'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project, ProjectStore } from './types'
import { DEFAULT_PROJECT_COLOR, PROJECT_STORE_VERSION } from './types'
import { loadProjectStore, saveProjectStore, registerProjectCollection } from './storage'

const SAVE_DEBOUNCE_MS = 600

function emptyStore(): ProjectStore {
  return { projects: {}, activeProjectId: null, version: PROJECT_STORE_VERSION }
}

export function useProjects() {
  const [store, setStore] = useState<ProjectStore>(emptyStore)
  const [hydrated, setHydrated] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const loaded = loadProjectStore()
    if (loaded) setStore(loaded)
    setHydrated(true)
  }, [])

  const persist = useCallback((next: ProjectStore) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveProjectStore(next), SAVE_DEBOUNCE_MS)
  }, [])

  function mutate(next: ProjectStore) {
    setStore(next)
    persist(next)
  }

  const createProject = useCallback((
    opts: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>
  ): Project => {
    const project: Project = {
      id: crypto.randomUUID(),
      title: opts.title ?? 'New Project',
      color: opts.color ?? DEFAULT_PROJECT_COLOR,
      description: opts.description ?? '',
      systemPrompt: opts.systemPrompt ?? '',
      fileAttachments: opts.fileAttachments ?? [],
      pinned: opts.pinned,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setStore((prev) => {
      const next = {
        ...prev,
        projects: { ...prev.projects, [project.id]: project },
      }
      persist(next)
      return next
    })
    // Name the project's knowledge-base collection so the Library labels it by title, not the derived id.
    registerProjectCollection(project.id, project.title)
    return project
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persist])

  const updateProject = useCallback((id: string, patch: Partial<Omit<Project, 'id' | 'createdAt'>>) => {
    setStore((prev) => {
      const existing = prev.projects[id]
      if (!existing) return prev
      const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() }
      // Keep the Library label in sync when the project is renamed (upsert is idempotent otherwise).
      if (patch.title && patch.title !== existing.title) registerProjectCollection(id, updated.title)
      const next = {
        ...prev,
        projects: { ...prev.projects, [id]: updated },
      }
      persist(next)
      return next
    })
  }, [persist])

  const deleteProject = useCallback((id: string) => {
    setStore((prev) => {
      const projects = { ...prev.projects }
      delete projects[id]
      const next = {
        ...prev,
        projects,
        activeProjectId: prev.activeProjectId === id ? null : prev.activeProjectId,
      }
      persist(next)
      return next
    })
  }, [persist])

  const setActiveProject = useCallback((id: string | null) => {
    setStore((prev) => {
      const next = { ...prev, activeProjectId: id }
      persist(next)
      return next
    })
  }, [persist])

  const projects = Object.values(store.projects).sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return b.updatedAt.localeCompare(a.updatedAt)
  })

  const activeProject = store.activeProjectId
    ? (store.projects[store.activeProjectId] ?? null)
    : null

  return {
    hydrated,
    projects,
    activeProject,
    activeProjectId: store.activeProjectId,
    createProject,
    updateProject,
    deleteProject,
    setActiveProject,
    mutate,
  }
}
