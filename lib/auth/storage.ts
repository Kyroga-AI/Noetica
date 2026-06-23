import type { ConnectorAuthStore, ConnectorId, ConnectorAuthState, MatrixAuthState } from './types'
import { secureGet, secureSet } from '@/lib/secure/secureStore'
import { isTauri } from '@/lib/tauri/bridge'

// Connector OAuth access + refresh tokens now live in the OS keychain (via secureStore), NOT plaintext
// localStorage. The legacy localStorage blob is migrated into the keychain on first read, then cleared.
const LEGACY_KEY = 'noetica-connector-auth'
const SECURE_KEY = 'connector-auth'

export async function loadAuthStore(): Promise<ConnectorAuthStore> {
  if (typeof window === 'undefined') return {}
  try {
    const secure = await secureGet(SECURE_KEY)
    if (secure) return JSON.parse(secure) as ConnectorAuthStore
    // No keychain entry yet — migrate any legacy plaintext blob, then return it.
    const legacy = window.localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      await secureSet(SECURE_KEY, legacy)
      if (isTauri()) { try { window.localStorage.removeItem(LEGACY_KEY) } catch { /* */ } }
      return JSON.parse(legacy) as ConnectorAuthStore
    }
    return {}
  } catch { return {} }
}

export async function saveAuthStore(store: ConnectorAuthStore): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    await secureSet(SECURE_KEY, JSON.stringify(store))
    if (isTauri()) { try { window.localStorage.removeItem(LEGACY_KEY) } catch { /* */ } }
  } catch { /* best-effort */ }
}

export async function setConnectorAuth(id: ConnectorId, state: ConnectorAuthState | MatrixAuthState): Promise<void> {
  const store = await loadAuthStore()
  await saveAuthStore({ ...store, [id]: state })
}

export async function clearConnectorAuth(id: ConnectorId): Promise<void> {
  const store = await loadAuthStore()
  const next = { ...store }
  delete next[id]
  await saveAuthStore(next)
}

export function isTokenExpired(state: ConnectorAuthState): boolean {
  if (!state.expiresAt) return false
  return Date.now() >= state.expiresAt - 60_000  // 60s early expiry buffer
}
