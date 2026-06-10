import type { NoteStore } from '@/lib/types/note'
import { NOTE_STORE_KEY, NOTE_STORE_VERSION } from '@/lib/types/note'
import { isTauri } from '@/lib/tauri/bridge'

export async function loadNoteStore(): Promise<NoteStore> {
  const empty: NoteStore = { notes: {}, version: NOTE_STORE_VERSION }
  try {
    if (isTauri()) {
      // eslint-disable-next-line
      const mod: any = await import('@tauri-apps/plugin-store' as string)
      // eslint-disable-next-line
      const store: any = await mod.load('noetica-notes.json', { autoSave: true })
      // eslint-disable-next-line
      const raw: any = await store.get(NOTE_STORE_KEY)
      if (raw && typeof raw === 'object' && raw.notes) return raw as NoteStore
      return empty
    }
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(NOTE_STORE_KEY) : null
    if (!raw) return empty
    const parsed = JSON.parse(raw) as NoteStore
    if (!parsed.notes || typeof parsed.notes !== 'object') return empty
    return parsed
  } catch {
    return empty
  }
}

export async function saveNoteStore(store: NoteStore): Promise<void> {
  try {
    if (isTauri()) {
      // eslint-disable-next-line
      const mod: any = await import('@tauri-apps/plugin-store' as string)
      // eslint-disable-next-line
      const s: any = await mod.load('noetica-notes.json', { autoSave: true })
      await s.set(NOTE_STORE_KEY, store)
      return
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(NOTE_STORE_KEY, JSON.stringify(store))
    }
  } catch { /* ignore */ }
}
