'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkItem, Sprint, Project, WorkItemStatus, WorkItemPriority, WorkItemType } from '@/lib/types/work'
import { loadWorkStore, saveWorkStore, type WorkStore, WORK_STORE_VERSION } from '@/lib/tasks/storage'

export interface UseWorkReturn {
  hydrated: boolean
  items: WorkItem[]
  sprints: Sprint[]
  projects: Project[]
  activeProject: Project | null
  setActiveProjectId: (id: string | null) => void
  createItem: (patch: Partial<WorkItem> & { title: string }) => WorkItem
  updateItem: (id: string, patch: Partial<WorkItem>) => void
  deleteItem: (id: string) => void
  moveItem: (id: string, status: WorkItemStatus) => void
  createSprint: (name: string, projectId: string, startAt?: string, endAt?: string) => Sprint
  updateSprint: (id: string, patch: Partial<Sprint>) => void
  deleteSprint: (id: string) => void
  createProject: (name: string, description?: string) => Project
  updateProject: (id: string, patch: Partial<Project>) => void
}

export function useWork(): UseWorkReturn {
  const [hydrated, setHydrated] = useState(false)
  const [store, setStore] = useState<WorkStore>({ items: {}, sprints: {}, projects: {}, version: WORK_STORE_VERSION })
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    loadWorkStore().then((s) => {
      if (!cancelled) { setStore(s); setHydrated(true) }
    })
    return () => { cancelled = true }
  }, [])

  function scheduleSave(next: WorkStore) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { saveWorkStore(next).catch(() => {}) }, 600)
  }

  function mutate(updater: (s: WorkStore) => WorkStore) {
    setStore((cur) => { const next = updater(cur); scheduleSave(next); return next })
  }

  const createItem = useCallback((patch: Partial<WorkItem> & { title: string }): WorkItem => {
    const now = new Date().toISOString()
    const maxOrder = Object.values(store.items)
      .filter((i) => i.status === (patch.status ?? 'backlog'))
      .reduce((m, i) => Math.max(m, i.order), -1)
    const item: WorkItem = {
      id: crypto.randomUUID(),
      type: 'task' as WorkItemType,
      description: '',
      status: 'backlog',
      priority: 'medium',
      assigneeId: undefined,
      projectId: activeProjectId ?? undefined,
      workroomId: undefined,
      sprintId: undefined,
      epicId: undefined,
      tags: [],
      relatedArtifactIds: [],
      relatedNoteIds: [],
      externalRefs: [],
      createdAt: now,
      updatedAt: now,
      order: maxOrder + 1,
      ...patch,
      title: patch.title.trim() || 'Untitled task',
    }
    mutate((s) => ({ ...s, items: { ...s.items, [item.id]: item } }))
    return item
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.items, activeProjectId])

  const updateItem = useCallback((id: string, patch: Partial<WorkItem>) => {
    mutate((s) => {
      const item = s.items[id]
      if (!item) return s
      return { ...s, items: { ...s.items, [id]: { ...item, ...patch, updatedAt: new Date().toISOString() } } }
    })
  }, [])

  const deleteItem = useCallback((id: string) => {
    mutate((s) => { const { [id]: _, ...rest } = s.items; return { ...s, items: rest } })
  }, [])

  const moveItem = useCallback((id: string, status: WorkItemStatus) => {
    mutate((s) => {
      const item = s.items[id]
      if (!item) return s
      const maxOrder = Object.values(s.items)
        .filter((i) => i.id !== id && i.status === status)
        .reduce((m, i) => Math.max(m, i.order), -1)
      return { ...s, items: { ...s.items, [id]: { ...item, status, order: maxOrder + 1, updatedAt: new Date().toISOString() } } }
    })
  }, [])

  const createSprint = useCallback((name: string, projectId: string, startAt?: string, endAt?: string): Sprint => {
    const now = new Date().toISOString()
    const sprint: Sprint = {
      id: crypto.randomUUID(), name, projectId,
      startAt: startAt ?? now,
      endAt: endAt ?? now,
      status: 'planned', itemIds: [],
    }
    mutate((s) => ({ ...s, sprints: { ...s.sprints, [sprint.id]: sprint } }))
    return sprint
  }, [])

  const updateSprint = useCallback((id: string, patch: Partial<Sprint>) => {
    mutate((s) => {
      const sp = s.sprints[id]; if (!sp) return s
      return { ...s, sprints: { ...s.sprints, [id]: { ...sp, ...patch } } }
    })
  }, [])

  const deleteSprint = useCallback((id: string) => {
    mutate((s) => {
      const { [id]: _, ...rest } = s.sprints
      // unassign items in this sprint
      const items = Object.fromEntries(
        Object.entries(s.items).map(([k, v]) => [k, v.sprintId === id ? { ...v, sprintId: undefined } : v])
      )
      return { ...s, sprints: rest, items }
    })
  }, [])

  const createProject = useCallback((name: string, description?: string): Project => {
    const now = new Date().toISOString()
    const project: Project = {
      id: crypto.randomUUID(), name, description,
      status: 'active', workroomIds: [], repositoryIds: [], sprintIds: [],
      createdAt: now, updatedAt: now,
    }
    mutate((s) => ({ ...s, projects: { ...s.projects, [project.id]: project } }))
    return project
  }, [])

  const updateProject = useCallback((id: string, patch: Partial<Project>) => {
    mutate((s) => {
      const p = s.projects[id]; if (!p) return s
      return { ...s, projects: { ...s.projects, [id]: { ...p, ...patch, updatedAt: new Date().toISOString() } } }
    })
  }, [])

  const items = Object.values(store.items).sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order
    return b.updatedAt.localeCompare(a.updatedAt)
  })
  const sprints = Object.values(store.sprints).sort((a, b) => a.startAt.localeCompare(b.startAt))
  const projects = Object.values(store.projects).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null

  return {
    hydrated, items, sprints, projects, activeProject, setActiveProjectId,
    createItem, updateItem, deleteItem, moveItem,
    createSprint, updateSprint, deleteSprint,
    createProject, updateProject,
  }
}
