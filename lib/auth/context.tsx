'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ConnectorAuthStore, ConnectorId, ConnectorAuthState, MatrixAuthState } from './types'
import { loadAuthStore, setConnectorAuth, clearConnectorAuth, isTokenExpired } from './storage'
import { refreshGoogleToken } from './providers/google'

type ConnectorAuthContextValue = {
  store: ConnectorAuthStore
  getAuth: (id: ConnectorId) => ConnectorAuthState | MatrixAuthState | undefined
  setAuth: (id: ConnectorId, state: ConnectorAuthState | MatrixAuthState) => void
  clearAuth: (id: ConnectorId) => void
  isConnected: (id: ConnectorId) => boolean
}

const ConnectorAuthContext = createContext<ConnectorAuthContextValue | null>(null)

export function ConnectorAuthProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<ConnectorAuthStore>({})

  // Load on mount
  useEffect(() => {
    setStore(loadAuthStore())
  }, [])

  const setAuth = useCallback((id: ConnectorId, state: ConnectorAuthState | MatrixAuthState) => {
    setConnectorAuth(id, state)
    setStore(loadAuthStore())
  }, [])

  const clearAuth = useCallback((id: ConnectorId) => {
    clearConnectorAuth(id)
    setStore(loadAuthStore())
  }, [])

  const getAuth = useCallback((id: ConnectorId) => store[id], [store])

  const isConnected = useCallback((id: ConnectorId): boolean => {
    const auth = store[id]
    return auth?.status === 'connected' && !!auth.accessToken
  }, [store])

  // Auto-refresh Google token when expired
  useEffect(() => {
    const google = store.google
    if (!google || google.status !== 'connected') return
    if (!isTokenExpired(google)) return
    if (!google.refreshToken) return

    // Get client ID from settings in localStorage
    const settingsRaw = localStorage.getItem('noetica-settings')
    if (!settingsRaw) return
    const settings = JSON.parse(settingsRaw) as { oauthGoogleClientId?: string }
    const clientId = settings.oauthGoogleClientId
    if (!clientId) return

    refreshGoogleToken(google.refreshToken, clientId)
      .then((patch) => {
        setAuth('google', { ...google, ...patch })
      })
      .catch(() => {
        setAuth('google', { ...google, status: 'error', error: 'Token refresh failed — please reconnect' })
      })
  }, [store.google, setAuth])

  return (
    <ConnectorAuthContext.Provider value={{ store, getAuth, setAuth, clearAuth, isConnected }}>
      {children}
    </ConnectorAuthContext.Provider>
  )
}

export function useConnectorAuth() {
  const ctx = useContext(ConnectorAuthContext)
  if (!ctx) throw new Error('useConnectorAuth must be used inside ConnectorAuthProvider')
  return ctx
}
