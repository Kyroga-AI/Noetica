/**
 * Session storage adapter.
 *
 * DURABLE PRIMARY: the always-on Agent Machine (`/api/sessions` → ~/.noetica/sessions.json).
 * This is what makes chats survive quit — WebKit localStorage only flushes on quit (unreliable
 * on force-quit) and the @tauri-apps/plugin-store isn't installed, so neither is dependable on
 * its own. The AM writes a real file on every save, so reload restores it deterministically.
 *
 * CACHE / FALLBACK: window.localStorage — written synchronously on every save (so a flush-on-
 * quit lands instantly) and read if the AM is unreachable at startup.
 */
import type { SessionStore } from './types'
import { SESSION_STORE_KEY, SESSION_STORE_VERSION } from './types'

const SESSIONS_URL = '/api/sessions'

async function loadFromAM(): Promise<SessionStore | null> {
  try {
    const res = await fetch(SESSIONS_URL)
    if (!res.ok) return null
    const raw = (await res.json()) as SessionStore | null
    if (!raw || raw.version !== SESSION_STORE_VERSION) return null
    return raw
  } catch { return null }
}

function loadFromLocal(): SessionStore | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SESSION_STORE_KEY)
    if (!raw) return null
    const parsed: SessionStore = JSON.parse(raw)
    if (parsed.version !== SESSION_STORE_VERSION) return null
    return parsed
  } catch { return null }
}

export async function loadSessionStore(): Promise<SessionStore | null> {
  // Durable file first; fall back to the local cache if the AM isn't up yet.
  return (await loadFromAM()) ?? loadFromLocal()
}

export async function saveSessionStore(store: SessionStore): Promise<void> {
  // Synchronous local cache first (survives an immediate quit), then durable file via the AM.
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(SESSION_STORE_KEY, JSON.stringify(store)) } catch { /* quota */ }
  }
  try {
    await fetch(SESSIONS_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(store), keepalive: true })
  } catch { /* AM unreachable — local cache still holds it */ }
}

export async function clearSessionStore(): Promise<void> {
  if (typeof window !== 'undefined') window.localStorage.removeItem(SESSION_STORE_KEY)
  try { await fetch(SESSIONS_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'null', keepalive: true }) } catch { /* best-effort */ }
}
