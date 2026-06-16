import type { MemoryStore } from './types'
import { MEMORY_STORE_KEY, MEMORY_STORE_VERSION } from './types'
import { isTauri } from '@/lib/tauri/bridge'

async function getTauriStore() {
  try {
    type StoreHandle = {
      get: <T>(key: string) => Promise<T | null>
      set: (key: string, value: unknown) => Promise<void>
      delete: (key: string) => Promise<void>
    }
    // eslint-disable-next-line
    const mod: any = await import(/* webpackIgnore: true */ '@tauri-apps/plugin-store' as string)
    // eslint-disable-next-line
    return (mod.load('noetica-memory.json', { autoSave: true }) as Promise<StoreHandle>)
  } catch {
    return null
  }
}

export function emptyMemoryStore(): MemoryStore {
  return { version: MEMORY_STORE_VERSION, entries: [] }
}

export async function loadMemoryStore(): Promise<MemoryStore> {
  if (isTauri()) {
    try {
      const store = await getTauriStore()
      if (store) {
        const raw = await store.get<MemoryStore>(MEMORY_STORE_KEY)
        if (raw && raw.version === MEMORY_STORE_VERSION) return raw
      }
    } catch { /* fall through */ }
  }
  if (typeof window === 'undefined') return emptyMemoryStore()
  try {
    const raw = window.localStorage.getItem(MEMORY_STORE_KEY)
    if (!raw) return emptyMemoryStore()
    const parsed: MemoryStore = JSON.parse(raw)
    if (parsed.version !== MEMORY_STORE_VERSION) return emptyMemoryStore()
    return parsed
  } catch {
    return emptyMemoryStore()
  }
}

export async function saveMemoryStore(store: MemoryStore): Promise<void> {
  if (isTauri()) {
    try {
      const tauriStore = await getTauriStore()
      if (tauriStore) { await tauriStore.set(MEMORY_STORE_KEY, store); return }
    } catch { /* fall through */ }
  }
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(MEMORY_STORE_KEY, JSON.stringify(store)) } catch { /* quota */ }
  }
}
