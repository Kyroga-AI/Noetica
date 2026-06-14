import type { ConnectorAuthStore, ConnectorId, ConnectorAuthState, MatrixAuthState } from './types'

const STORAGE_KEY = 'noetica-connector-auth'

export function loadAuthStore(): ConnectorAuthStore {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ConnectorAuthStore) : {}
  } catch {
    return {}
  }
}

export function saveAuthStore(store: ConnectorAuthStore): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // storage quota exceeded — ignore
  }
}

export function getConnectorAuth(id: ConnectorId): ConnectorAuthState | MatrixAuthState | undefined {
  return loadAuthStore()[id]
}

export function setConnectorAuth(id: ConnectorId, state: ConnectorAuthState | MatrixAuthState): void {
  const store = loadAuthStore()
  saveAuthStore({ ...store, [id]: state })
}

export function clearConnectorAuth(id: ConnectorId): void {
  const store = loadAuthStore()
  const next = { ...store }
  delete next[id]
  saveAuthStore(next)
}

export function isTokenExpired(state: ConnectorAuthState): boolean {
  if (!state.expiresAt) return false
  return Date.now() >= state.expiresAt - 60_000  // 60s early expiry buffer
}
