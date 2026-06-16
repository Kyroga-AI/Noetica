'use client'

import { useEffect, useState } from 'react'
import { useSettings } from '@/lib/settings/context'
import { useConnectorAuth } from '@/lib/auth/context'
import type { ConnectorId } from '@/lib/auth/types'
import { initiateGoogleOAuth, exchangeGoogleCode } from '@/lib/auth/providers/google'
import { initiateGithubOAuth, exchangeGithubCode } from '@/lib/auth/providers/github'
import { initiateSlackOAuth, exchangeSlackCode } from '@/lib/auth/providers/slack'
import { initiateLinearOAuth, exchangeLinearCode } from '@/lib/auth/providers/linear'
import { initiateNotionOAuth, exchangeNotionCode } from '@/lib/auth/providers/notion'
import { loginMatrix, logoutMatrix } from '@/lib/auth/providers/matrix'

function getRedirectUri() {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/oauth/callback`
}

type OAuthProvider = {
  id: ConnectorId
  label: string
  description: string
  clientIdKey: keyof ReturnType<typeof useSettings>['settings']
  initiate: (clientId: string, redirectUri: string) => Promise<void>
  exchange: (code: string, clientId: string, redirectUri: string) => Promise<unknown>
  color: string
}

const OAUTH_PROVIDERS: OAuthProvider[] = [
  {
    id: 'google',
    label: 'Google',
    description: 'Gmail + Google Calendar — read access for Mail and Calendar panels.',
    clientIdKey: 'oauthGoogleClientId',
    initiate: initiateGoogleOAuth,
    exchange: exchangeGoogleCode,
    color: '#4285F4',
  },
  {
    id: 'github',
    label: 'GitHub',
    description: 'Read repos, issues, and user profile.',
    clientIdKey: 'oauthGithubClientId',
    initiate: initiateGithubOAuth,
    exchange: exchangeGithubCode,
    color: '#24292e',
  },
  {
    id: 'slack',
    label: 'Slack',
    description: 'Read channels and messages.',
    clientIdKey: 'oauthSlackClientId',
    initiate: initiateSlackOAuth,
    exchange: exchangeSlackCode,
    color: '#4A154B',
  },
  {
    id: 'linear',
    label: 'Linear',
    description: 'Read assigned issues, teams, and projects.',
    clientIdKey: 'oauthLinearClientId',
    initiate: initiateLinearOAuth,
    exchange: exchangeLinearCode,
    color: '#5E6AD2',
  },
]

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    connected:    'bg-[#dcfce7] text-[#16a34a]',
    connecting:   'bg-[#fef9c3] text-[#92400e]',
    error:        'bg-[#fef2f2] text-[#dc2626]',
    disconnected: 'bg-[var(--color-background-tertiary)] text-[var(--color-text-tertiary)]',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${map[status] ?? map.disconnected}`}>
      {status === 'connected' ? 'Connected' :
       status === 'connecting' ? 'Connecting…' :
       status === 'error' ? 'Error' : 'Not connected'}
    </span>
  )
}

function OAuthProviderRow({ provider }: { provider: OAuthProvider }) {
  const { settings, update } = useSettings()
  const { store, setAuth, clearAuth } = useConnectorAuth()
  const [editingKey, setEditingKey] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [error, setError] = useState('')

  const clientId = (settings[provider.clientIdKey] as string) ?? ''
  const auth = store[provider.id]
  const status = auth?.status ?? 'disconnected'

  // Listen for OAuth callback postMessage
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      const { type, code, state, error: cbError } = event.data as {
        type?: string; code?: string; state?: string; error?: string
      }
      if (type !== 'oauth_callback') return
      if (cbError) {
        setAuth(provider.id, { status: 'error', error: cbError })
        return
      }
      if (!code) return

      setAuth(provider.id, { status: 'connecting' })
      provider.exchange(code, clientId, getRedirectUri())
        .then((authState) => {
          setAuth(provider.id, authState as Parameters<typeof setAuth>[1])
          setError('')
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Connection failed'
          setAuth(provider.id, { status: 'error', error: msg })
          setError(msg)
        })
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [provider, clientId, setAuth])

  function connect() {
    if (!clientId) { setEditingKey(true); return }
    setError('')
    setAuth(provider.id, { status: 'connecting' })
    provider.initiate(clientId, getRedirectUri()).catch((err: unknown) => {
      setAuth(provider.id, { status: 'error', error: err instanceof Error ? err.message : 'Failed' })
    })
  }

  function disconnect() {
    clearAuth(provider.id)
  }

  function saveClientId() {
    update({ [provider.clientIdKey]: keyDraft.trim() } as Record<string, string>)
    setEditingKey(false)
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Provider icon placeholder */}
        <div
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-white"
          style={{ background: provider.color }}
        >
          {provider.label[0]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">{provider.label}</span>
            <StatusChip status={status} />
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{provider.description}</p>
          {auth?.userInfo?.email && (
            <p className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">
              Signed in as {auth.userInfo.name ?? auth.userInfo.email} ({auth.userInfo.email})
            </p>
          )}
          {auth?.status === 'error' && auth.error && (
            <p className="mt-1 text-[11px] text-[#dc2626]">{auth.error}</p>
          )}
        </div>
        <div className="shrink-0">
          {status === 'connected'
            ? <button onClick={disconnect} className="rounded-lg border border-[var(--color-border-secondary)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] transition hover:border-[#fecaca] hover:text-[#dc2626]">Disconnect</button>
            : <button onClick={connect} disabled={status === 'connecting'} className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-2.5 py-1 text-xs font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe] disabled:opacity-50">
                {status === 'connecting' ? 'Connecting…' : 'Connect'}
              </button>}
        </div>
      </div>

      {/* Client ID config */}
      <div className="border-t border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-2.5">
        {editingKey ? (
          <div className="flex gap-2">
            <input
              autoFocus
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="OAuth Client ID…"
              className="flex-1 rounded-lg border border-[#bfdbfe] bg-[var(--color-background-primary)] px-2.5 py-1.5 font-mono text-xs text-[var(--color-text-primary)] outline-none focus:border-[#1d4ed8]"
              onKeyDown={(e) => { if (e.key === 'Enter') saveClientId(); if (e.key === 'Escape') setEditingKey(false) }}
            />
            <button onClick={saveClientId} className="rounded-lg bg-[#1d4ed8] px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-[#1e40af]">Save</button>
            <button onClick={() => setEditingKey(false)} className="rounded-lg border border-[var(--color-border-secondary)] px-2.5 py-1.5 text-xs text-[var(--color-text-secondary)]">Cancel</button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-[var(--color-text-tertiary)]">
              {clientId ? `Client ID: ${clientId.slice(0, 16)}…` : 'No client ID configured'}
            </span>
            <button
              onClick={() => { setKeyDraft(clientId); setEditingKey(true) }}
              className="text-[11px] text-[#1d4ed8] transition hover:underline"
            >
              {clientId ? 'Edit' : 'Add client ID'}
            </button>
          </div>
        )}
        {error && <p className="mt-1 text-[11px] text-[#dc2626]">{error}</p>}
      </div>
    </div>
  )
}

function MatrixLoginRow() {
  const { settings, update } = useSettings()
  const { store, setAuth, clearAuth } = useConnectorAuth()
  const [expanded, setExpanded] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(false)

  const auth = store.matrix
  const status = auth?.status ?? 'disconnected'
  const homeserver = settings.matrixHomeserver || 'https://matrix.org'

  async function connect() {
    if (!username.trim() || !password.trim()) { setError('Username and password required'); return }
    setConnecting(true)
    setError('')
    try {
      const state = await loginMatrix(homeserver, username.trim(), password)
      setAuth('matrix', state)
      setExpanded(false)
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setConnecting(false)
    }
  }

  function disconnect() {
    if (auth?.accessToken && auth.homeserver) {
      void logoutMatrix(auth.homeserver, auth.accessToken).catch(() => {})
    }
    clearAuth('matrix')
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0dbd8b] text-[10px] font-bold text-white">M</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">Matrix</span>
            <StatusChip status={status} />
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Federated chat. Connect to any Matrix homeserver.</p>
          {auth?.userInfo?.login && (
            <p className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">
              Signed in as {auth.userInfo.login} on {(auth as { homeserver?: string }).homeserver ?? homeserver}
            </p>
          )}
          {auth?.status === 'error' && auth.error && (
            <p className="mt-1 text-[11px] text-[#dc2626]">{auth.error}</p>
          )}
        </div>
        <div className="shrink-0">
          {status === 'connected'
            ? <button onClick={disconnect} className="rounded-lg border border-[var(--color-border-secondary)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] transition hover:border-[#fecaca] hover:text-[#dc2626]">Disconnect</button>
            : <button onClick={() => setExpanded((v) => !v)} className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-2.5 py-1 text-xs font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe]">
                {expanded ? 'Cancel' : 'Connect'}
              </button>}
        </div>
      </div>

      {expanded && status !== 'connected' && (
        <div className="border-t border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-3 space-y-2.5">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">Homeserver</label>
            <input
              value={homeserver}
              onChange={(e) => update({ matrixHomeserver: e.target.value })}
              placeholder="https://matrix.org"
              className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[#bfdbfe]"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="@user:matrix.org"
              autoComplete="username"
              className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[#bfdbfe]"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[#bfdbfe]"
              onKeyDown={(e) => { if (e.key === 'Enter') void connect() }}
            />
          </div>
          {error && <p className="text-[11px] text-[#dc2626]">{error}</p>}
          <button
            onClick={() => void connect()}
            disabled={connecting}
            className="w-full rounded-xl bg-[#1d4ed8] py-2 text-xs font-semibold text-white transition hover:bg-[#1e40af] disabled:opacity-50"
          >
            {connecting ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      )}

      <div className="border-t border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-2">
        <p className="text-[11px] text-[var(--color-text-tertiary)]">
          Credentials are not stored — only your access token is saved locally.
        </p>
      </div>
    </div>
  )
}

function NotionOAuthRow() {
  const { settings, update } = useSettings()
  const { store, setAuth, clearAuth } = useConnectorAuth()
  const [editingKeys, setEditingKeys] = useState(false)
  const [idDraft, setIdDraft] = useState('')
  const [secretDraft, setSecretDraft] = useState('')
  const [error, setError] = useState('')

  const clientId = settings.oauthNotionClientId ?? ''
  const clientSecret = settings.oauthNotionClientSecret ?? ''
  const auth = store.notion
  const status = auth?.status ?? 'disconnected'

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      const { type, code, error: cbError } = event.data as { type?: string; code?: string; error?: string }
      if (type !== 'oauth_callback') return
      if (cbError) { setAuth('notion', { status: 'error', error: cbError }); return }
      if (!code) return
      setAuth('notion', { status: 'connecting' })
      exchangeNotionCode(code, clientId, getRedirectUri(), clientSecret)
        .then((s) => { setAuth('notion', s); setError('') })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Connection failed'
          setAuth('notion', { status: 'error', error: msg })
          setError(msg)
        })
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [clientId, clientSecret, setAuth])

  function connect() {
    if (!clientId || !clientSecret) { setEditingKeys(true); return }
    setError('')
    setAuth('notion', { status: 'connecting' })
    initiateNotionOAuth(clientId, getRedirectUri()).catch((err: unknown) => {
      setAuth('notion', { status: 'error', error: err instanceof Error ? err.message : 'Failed' })
    })
  }

  function saveKeys() {
    update({ oauthNotionClientId: idDraft.trim(), oauthNotionClientSecret: secretDraft.trim() } as Record<string, string>)
    setEditingKeys(false)
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#000000] text-[10px] font-bold text-white">N</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">Notion</span>
            <StatusChip status={status} />
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Read pages and databases from your workspace.</p>
          {auth?.userInfo?.name && (
            <p className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">
              {auth.userInfo.name}{auth.userInfo.email ? ` (${auth.userInfo.email})` : ''}
            </p>
          )}
          {auth?.status === 'error' && auth.error && (
            <p className="mt-1 text-[11px] text-[#dc2626]">{auth.error}</p>
          )}
        </div>
        <div className="shrink-0">
          {status === 'connected'
            ? <button onClick={() => clearAuth('notion')} className="rounded-lg border border-[var(--color-border-secondary)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] transition hover:border-[#fecaca] hover:text-[#dc2626]">Disconnect</button>
            : <button onClick={connect} disabled={status === 'connecting'} className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-2.5 py-1 text-xs font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe] disabled:opacity-50">
                {status === 'connecting' ? 'Connecting…' : 'Connect'}
              </button>}
        </div>
      </div>

      <div className="border-t border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-2.5">
        {editingKeys ? (
          <div className="space-y-2">
            <input autoFocus value={idDraft} onChange={(e) => setIdDraft(e.target.value)} placeholder="OAuth Client ID…"
              className="w-full rounded-lg border border-[#bfdbfe] bg-[var(--color-background-primary)] px-2.5 py-1.5 font-mono text-xs outline-none focus:border-[#1d4ed8]" />
            <input type="password" value={secretDraft} onChange={(e) => setSecretDraft(e.target.value)} placeholder="OAuth Client Secret…"
              className="w-full rounded-lg border border-[#bfdbfe] bg-[var(--color-background-primary)] px-2.5 py-1.5 font-mono text-xs outline-none focus:border-[#1d4ed8]"
              onKeyDown={(e) => { if (e.key === 'Enter') saveKeys() }} />
            <div className="flex gap-2">
              <button onClick={saveKeys} className="rounded-lg bg-[#1d4ed8] px-2.5 py-1.5 text-xs font-semibold text-white">Save</button>
              <button onClick={() => setEditingKeys(false)} className="rounded-lg border border-[var(--color-border-secondary)] px-2.5 py-1.5 text-xs text-[var(--color-text-secondary)]">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-[var(--color-text-tertiary)]">
              {clientId ? `Client ID: ${clientId.slice(0, 14)}… · secret set` : 'No credentials configured'}
            </span>
            <button onClick={() => { setIdDraft(clientId); setSecretDraft(clientSecret); setEditingKeys(true) }}
              className="text-[11px] text-[#1d4ed8] transition hover:underline">
              {clientId ? 'Edit' : 'Add credentials'}
            </button>
          </div>
        )}
        {error && <p className="mt-1 text-[11px] text-[#dc2626]">{error}</p>}
      </div>
    </div>
  )
}

export function ConnectionsPanel() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Connect external accounts to populate the Mail, Calendar, Notes, and Matrix rail panels.
          Credentials stay on your machine and are never transmitted to third parties.
        </p>
      </div>

      <div className="space-y-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">OAuth providers</div>
        {OAUTH_PROVIDERS.map((p) => <OAuthProviderRow key={p.id} provider={p} />)}
        <NotionOAuthRow />
      </div>

      <div className="space-y-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">Direct login</div>
        <MatrixLoginRow />
      </div>

      <div className="rounded-xl border border-[#fef9c3] bg-[#fefce8] px-4 py-3 text-xs leading-5 text-[#854d0e]">
        <p className="font-semibold">How to get a client ID</p>
        <p className="mt-1">Register an OAuth app with each provider, set the redirect URI to <code className="font-mono">{typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/oauth/callback</code>, and paste the credentials above. Notion requires a client secret; all other providers use PKCE and need only a client ID.</p>
      </div>
    </div>
  )
}
