'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { defaultSettings } from './defaults'
import type { NoeticaSettings } from './types'

const STORAGE_KEY = 'noetica:settings'

function load(): NoeticaSettings {
  if (typeof window === 'undefined') return defaultSettings
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings
    return { ...defaultSettings, ...JSON.parse(raw) }
  } catch {
    return defaultSettings
  }
}

function save(settings: NoeticaSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage unavailable — continue without persistence
  }
}

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
    setSettings(load())
  }, [])

  const update = useCallback((patch: Partial<NoeticaSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch }
      save(next)
      return next
    })
  }, [])

  const value = useMemo(() => ({ settings, update }), [settings, update])

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  return useContext(SettingsContext)
}
