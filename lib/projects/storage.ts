import type { ProjectStore } from './types'
import { PROJECT_STORE_KEY, PROJECT_STORE_VERSION, projectCollectionId } from './types'
import { amUrl } from '@/lib/tauri/bridge'

export function loadProjectStore(): ProjectStore | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PROJECT_STORE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ProjectStore
    if (parsed.version !== PROJECT_STORE_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

export function saveProjectStore(store: ProjectStore): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(PROJECT_STORE_KEY, JSON.stringify(store))
  } catch {
    // quota exceeded or private browsing
  }
}

/**
 * Tell the agent-machine the project's collection TITLE so the Library shows "Q3 Research" instead of the bare
 * derived id `proj-a1b2c3`. Fire-and-forget + idempotent: called on project create AND rename (POST is an upsert).
 * The collection itself is created lazily by uploads; this only names it. Failure is non-fatal — retrieval still
 * scopes by the derived id regardless, so a missed registration just means a less-pretty Library label.
 */
export function registerProjectCollection(projectId: string, title: string): void {
  if (typeof window === 'undefined') return
  try {
    void fetch(amUrl('/api/collections'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: projectCollectionId(projectId), name: title, source: 'project' }),
    }).catch(() => { /* agent-machine offline — Library label only */ })
  } catch { /* never let a label update break project mutation */ }
}
