'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { defaultSettings } from './defaults'
import type { NoeticaSettings } from './types'
import { isTauri, invokeTauri } from '@/lib/tauri/bridge'
import { secureGet, secureSet } from '@/lib/secure/secureStore'

const STORAGE_KEY = 'noetica:settings'

// Secret fields are stripped from the persisted settings blob and stored in the OS keychain (via secureStore)
// instead — never written to the plaintext settings file / localStorage. Re-merged on load.
const SECRET_KEYS: (keyof NoeticaSettings)[] = [
  'anthropicApiKey', 'openaiApiKey', 'googleApiKey', 'mistralApiKey', 'neuronpediaApiKey', 'openrouterApiKey',
  'huggingfaceApiKey', 'serperApiKey', 'giteaToken', 'githubPat', 'mailPassword', 'calPassword',
  'elevenlabsApiKey', 'oauthGithubClientSecret', 'oauthNotionClientSecret', 'prophetMeshApiKey',
]
const SECRETS_KC = 'settings-secrets'

function splitSecrets(s: NoeticaSettings): { pub: Record<string, unknown>; secrets: Record<string, string> } {
  const pub: Record<string, unknown> = { ...s }; const secrets: Record<string, string> = {}
  for (const k of SECRET_KEYS) { const v = s[k]; if (typeof v === 'string' && v) secrets[k] = v; delete pub[k] }
  return { pub, secrets }
}

// ── Storage adapters ──────────────────────────────────────────────────────────

async function getTauriStore() {
  try {
    type StoreHandle = {
      get: <T>(key: string) => Promise<T | null>
      set: (key: string, value: unknown) => Promise<void>
    }
    // Dynamic import — guarded by isTauri()
    // eslint-disable-next-line
    const mod: any = await import(/* webpackIgnore: true */ '@tauri-apps/plugin-store' as string)
    // eslint-disable-next-line
    return (mod.load('noetica-settings.json', { autoSave: true }) as Promise<StoreHandle>)
  } catch {
    return null
  }
}

async function loadPublic(): Promise<Partial<NoeticaSettings>> {
  if (isTauri()) {
    try {
      const store = await getTauriStore()
      if (store) { const raw = await store.get<NoeticaSettings>(STORAGE_KEY); if (raw) return raw }
    } catch { /* fall through */ }
  }
  if (typeof window === 'undefined') return {}
  try { const raw = window.localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : {} } catch { return {} }
}

async function loadSettings(): Promise<NoeticaSettings> {
  const pub = await loadPublic()
  let secrets: Record<string, string> = {}
  try { const s = await secureGet(SECRETS_KC); if (s) secrets = JSON.parse(s) } catch { /* */ }
  // Merge keychain secrets last; any legacy inline secrets in `pub` are superseded + get stripped on next save.
  return { ...defaultSettings, ...pub, ...secrets } as NoeticaSettings
}

async function persistSettings(settings: NoeticaSettings): Promise<void> {
  const { pub, secrets } = splitSecrets(settings)
  try { await secureSet(SECRETS_KC, JSON.stringify(secrets)) } catch { /* */ }
  if (isTauri()) {
    try {
      const store = await getTauriStore()
      if (store) { await store.set(STORAGE_KEY, pub); return }
    } catch { /* fall through */ }
  }
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pub)) } catch { /* quota */ }
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

type SettingsContextValue = {
  settings: NoeticaSettings
  update: (patch: Partial<NoeticaSettings>) => void
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: defaultSettings,
  update: () => {},
})

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<NoeticaSettings>(defaultSettings)

  useEffect(() => {
    loadSettings().then(async (loaded) => {
      // Migrate: re-persist so any legacy inline secrets get stripped from the plaintext store into the keychain.
      void persistSettings(loaded)
      if (isTauri()) {
        // In Tauri, agent-machine is always the runtime — force it regardless of
        // what's stored. probe_agent_machine is best-effort for confirming liveness
        // but we don't gate on it; the transport hardcodes 127.0.0.1:8080 anyway.
        const amUrl = await invokeTauri<string | null>('probe_agent_machine').catch(() => null)
        setSettings({
          ...loaded,
          runtimeMode: 'agent-machine',
          agentMachineEndpoint: amUrl ?? 'http://127.0.0.1:8080',
        })
      } else {
        const amUrl = await fetch('http://127.0.0.1:8080/api/status', { signal: AbortSignal.timeout(3_000) })
          .then(r => r.ok ? 'http://127.0.0.1:8080' : null)
          .catch(() => null)
        setSettings(amUrl
          ? { ...loaded, runtimeMode: 'agent-machine', agentMachineEndpoint: amUrl }
          : loaded
        )
      }
    })
  }, [])

  const update = useCallback((patch: Partial<NoeticaSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch }
      void persistSettings(next)
      return next
    })
  }, [])

  const value = useMemo(() => ({ settings, update }), [settings, update])

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  return useContext(SettingsContext)
}
