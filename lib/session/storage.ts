/**
 * Session storage adapter.
 * Tauri: @tauri-apps/plugin-store (persists across restarts).
 * Browser dev: localStorage fallback.
 */
import type { SessionStore } from './types'
import { SESSION_STORE_KEY, SESSION_STORE_VERSION } from './types'
import { isTauri } from '@/lib/tauri/bridge'

async function getTauriStore() {
  try {
    type StoreHandle = {
      get: <T>(key: string) => Promise<T | null>
      set: (key: string, value: unknown) => Promise<void>
      delete: (key: string) => Promise<void>
    }
    // Dynamic import — @tauri-apps/plugin-store not in devDependencies; guarded by isTauri()
    // eslint-disable-next-line
    const mod: any = await import(/* webpackIgnore: true */ '@tauri-apps/plugin-store' as string)
    // eslint-disable-next-line
    return (mod.load('noetica-sessions.json', { autoSave: true }) as Promise<StoreHandle>)
  } catch {
    return null
  }
}

export async function loadSessionStore(): Promise<SessionStore | null> {
  if (isTauri()) {
    try {
      const store = await getTauriStore()
      if (!store) return null
      const raw = await store.get<SessionStore>(SESSION_STORE_KEY)
      if (!raw || raw.version !== SESSION_STORE_VERSION) return null
      return raw
    } catch {
      return null
    }
  }
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SESSION_STORE_KEY)
    if (!raw) return null
    const parsed: SessionStore = JSON.parse(raw)
    if (parsed.version !== SESSION_STORE_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

export async function saveSessionStore(store: SessionStore): Promise<void> {
  if (isTauri()) {
    try {
      const tauriStore = await getTauriStore()
      if (tauriStore) { await tauriStore.set(SESSION_STORE_KEY, store); return }
    } catch { /* fall through */ }
  }
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(SESSION_STORE_KEY, JSON.stringify(store)) } catch { /* quota */ }
}

export async function clearSessionStore(): Promise<void> {
  if (isTauri()) {
    try {
      const tauriStore = await getTauriStore()
      if (tauriStore) { await tauriStore.delete(SESSION_STORE_KEY); return }
    } catch { /* fall through */ }
  }
  if (typeof window !== 'undefined') window.localStorage.removeItem(SESSION_STORE_KEY)
}
