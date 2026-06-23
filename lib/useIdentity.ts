'use client'
import { useEffect, useState } from 'react'
import { useSettings } from '@/lib/settings/context'

export interface Identity { displayName: string; email: string; slug: string }

// A fresh install is nobody in particular until the user sets their profile — never a hardcoded developer.
const NEUTRAL: Identity = { displayName: 'You', email: '', slug: 'user' }

/** The current user's profile, fetched from agent-machine's /api/identity. Neutral default until set. */
export function useIdentity(): Identity {
  const { settings } = useSettings()
  const [id, setId] = useState<Identity>(NEUTRAL)
  useEffect(() => {
    const base = (settings.agentMachineEndpoint || 'http://127.0.0.1:8080').replace(/\/$/, '')
    let alive = true
    fetch(`${base}/api/identity`, { signal: AbortSignal.timeout(4000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Partial<Identity> | null) => {
        if (alive && j && j.displayName) setId({ displayName: j.displayName, email: j.email ?? '', slug: j.slug ?? 'user' })
      })
      .catch(() => { /* keep the neutral default */ })
    return () => { alive = false }
  }, [settings.agentMachineEndpoint])
  return id
}

/** Uppercase first letter for an avatar glyph, with a neutral fallback. */
export function initialOf(name: string): string {
  const c = name.trim()[0]
  return c ? c.toUpperCase() : '·'
}
