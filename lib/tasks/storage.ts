import type { WorkItem, Sprint, Project } from '@/lib/types/work'
import { isTauri } from '@/lib/tauri/bridge'

export interface WorkStore {
  items: Record<string, WorkItem>
  sprints: Record<string, Sprint>
  projects: Record<string, Project>
  version: number
}

export const WORK_STORE_KEY = 'noetica:work'
export const WORK_STORE_VERSION = 1

const empty = (): WorkStore => ({ items: {}, sprints: {}, projects: {}, version: WORK_STORE_VERSION })

export async function loadWorkStore(): Promise<WorkStore> {
  try {
    if (isTauri()) {
      // eslint-disable-next-line
      const mod: any = await import(/* webpackIgnore: true */ '@tauri-apps/plugin-store' as string)
      // eslint-disable-next-line
      const store: any = await mod.load('noetica-work.json', { autoSave: true })
      // eslint-disable-next-line
      const raw: any = await store.get(WORK_STORE_KEY)
      if (raw && typeof raw === 'object' && raw.items && typeof raw.items === 'object') return raw as WorkStore
      return empty()
    }
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(WORK_STORE_KEY) : null
    if (!raw) return empty()
    const parsed = JSON.parse(raw) as WorkStore
    if (!parsed.items) return empty()
    return parsed
  } catch {
    return empty()
  }
}

export async function saveWorkStore(store: WorkStore): Promise<void> {
  try {
    if (isTauri()) {
      // eslint-disable-next-line
      const mod: any = await import(/* webpackIgnore: true */ '@tauri-apps/plugin-store' as string)
      // eslint-disable-next-line
      const s: any = await mod.load('noetica-work.json', { autoSave: true })
      await s.set(WORK_STORE_KEY, store)
      return
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(WORK_STORE_KEY, JSON.stringify(store))
    }
  } catch { /* ignore */ }
}
