import type { WorkroomStore } from '@/lib/types/workroom'
import { WORKROOM_STORE_KEY, WORKROOM_STORE_VERSION } from '@/lib/types/workroom'
import { isTauri } from '@/lib/tauri/bridge'

export async function loadWorkroomStore(): Promise<WorkroomStore> {
  const empty: WorkroomStore = { workrooms: {}, version: WORKROOM_STORE_VERSION }
  try {
    if (isTauri()) {
      // eslint-disable-next-line
      const mod: any = await import('@tauri-apps/plugin-store' as string)
      // eslint-disable-next-line
      const store: any = await mod.load('noetica-workrooms.json', { autoSave: true })
      // eslint-disable-next-line
      const raw: any = await store.get(WORKROOM_STORE_KEY)
      if (raw?.workrooms) return raw as WorkroomStore
      return empty
    }
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(WORKROOM_STORE_KEY) : null
    if (!raw) return empty
    const parsed = JSON.parse(raw) as WorkroomStore
    if (!parsed.workrooms) return empty
    return parsed
  } catch {
    return empty
  }
}

export async function saveWorkroomStore(store: WorkroomStore): Promise<void> {
  try {
    if (isTauri()) {
      // eslint-disable-next-line
      const mod: any = await import('@tauri-apps/plugin-store' as string)
      // eslint-disable-next-line
      const s: any = await mod.load('noetica-workrooms.json', { autoSave: true })
      await s.set(WORKROOM_STORE_KEY, store)
      return
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(WORKROOM_STORE_KEY, JSON.stringify(store))
    }
  } catch { /* ignore */ }
}
