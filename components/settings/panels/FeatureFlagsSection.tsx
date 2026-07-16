'use client'

import { useEffect, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'

type Flag = { env: string; enabled: boolean; status: 'default-on' | 'opt-in' | 'experimental'; description: string }

const STATUS_STYLE: Record<Flag['status'], string> = {
  'default-on': 'bg-[#dcfce7] text-[#166534]',
  'opt-in': 'bg-[var(--accent-soft)] text-[var(--accent)]',
  'experimental': 'bg-[#fef3c7] text-[#92400e]',
}

/**
 * Live feature-flag inventory from the agent-machine (GET /api/flags). Shows each
 * NOETICA_* flag's runtime state + graduation status so it's clear what's actually
 * active and which experiments have graduated to default-on. Read-only — flags are
 * set via env at launch.
 */
export function FeatureFlagsSection() {
  const [flags, setFlags] = useState<Flag[] | null>(null)
  const [authRequired, setAuthRequired] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(amUrl('/api/flags'), { signal: AbortSignal.timeout(3000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad status'))))
      .then((d: { flags: Flag[]; auth_required: boolean }) => {
        if (cancelled) return
        setFlags(d.flags); setAuthRequired(d.auth_required)
      })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Feature flags</div>
        {authRequired && <span className="rounded-full bg-[#fee2e2] px-2 py-0.5 text-[10px] font-medium text-[#991b1b]">API token required</span>}
      </div>
      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Runtime state from the agent-machine. Set via NOETICA_* env at launch.</p>

      {error && <div className="mt-3 text-xs text-[var(--color-text-tertiary)]">agent-machine offline — flags unavailable.</div>}
      {!error && !flags && <div className="mt-3 text-xs text-[var(--color-text-tertiary)]">Loading…</div>}

      {flags && (
        <div className="mt-3 space-y-1.5">
          {flags.map((f) => (
            <div key={f.env} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--color-background-primary)] px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${f.enabled ? 'bg-[#16a34a]' : 'bg-[#cbd5e1]'}`} />
                  <code className="truncate text-[11px] text-[var(--color-text-primary)]">{f.env}</code>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${STATUS_STYLE[f.status]}`}>{f.status}</span>
                </div>
                <div className="ml-4 truncate text-[10px] text-[var(--color-text-tertiary)]">{f.description}</div>
              </div>
              <span className={`shrink-0 text-[11px] font-medium ${f.enabled ? 'text-[#16a34a]' : 'text-[var(--color-text-tertiary)]'}`}>
                {f.enabled ? 'on' : 'off'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
