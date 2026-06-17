'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { defaultSettings } from './defaults'
import type { NoeticaSettings } from './types'
import { isTauri, invokeTauri } from '@/lib/tauri/bridge'

const STORAGE_KEY = 'noetica:settings'

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

async function loadSettings(): Promise<NoeticaSettings> {
  if (isTauri()) {
    try {
      const store = await getTauriStore()
      if (store) {
        const raw = await store.get<NoeticaSettings>(STORAGE_KEY)
        if (raw) return { ...defaultSettings, ...raw }
      }
    } catch { /* fall through */ }
  }
  if (typeof window === 'undefined') return defaultSettings
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings
    return { ...defaultSettings, ...JSON.parse(raw) }
  } catch {
    return defaultSettings
  }
}

async function persistSettings(settings: NoeticaSettings): Promise<void> {
  if (isTauri()) {
    try {
      const store = await getTauriStore()
      if (store) { await store.set(STORAGE_KEY, settings); return }
    } catch { /* fall through */ }
  }
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)) } catch { /* quota */ }
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
      // Use Tauri command to get AM URL — bypasses WKWebView ATS/mixed-content
      // restrictions that block plain fetch() to http://127.0.0.1.
      // Falls back to HTTP probe in browser (non-Tauri) mode.
      let amUrl: string | null = null
      if (isTauri()) {
        // probe_agent_machine does a TCP connect — works for sidecar OR external AM
        amUrl = await invokeTauri<string | null>('probe_agent_machine').catch(() => null)
      } else {
        amUrl = await fetch('http://127.0.0.1:8080/api/status', { signal: AbortSignal.timeout(3_000) })
          .then(r => r.ok ? 'http://127.0.0.1:8080' : null)
          .catch(() => null)
      }
      if (amUrl) {
        setSettings({ ...loaded, runtimeMode: 'agent-machine', agentMachineEndpoint: amUrl })
      } else {
        setSettings(loaded)
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
