import type { ProjectStore } from './types'
import { PROJECT_STORE_KEY, PROJECT_STORE_VERSION } from './types'

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
