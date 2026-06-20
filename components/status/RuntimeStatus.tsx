'use client'

import { useEffect, useState } from 'react'
import { loadNoeticaStatus, type NoeticaStatusState } from '@/lib/client/noeticaStatus'
import { buildRuntimeRemediations, type RemediationItem } from '@/lib/client/remediation'
import type { NoeticaServiceCapabilityStatus } from '@/lib/contracts/noeticaService'

const badgeClassByStatus: Record<NoeticaServiceCapabilityStatus | 'loading' | 'error', string> = {
  ready:          'border-[#86efac] bg-[#dcfce7] text-[#16a34a]',
  not_configured: 'border-[#fde68a] bg-[#fef9c3] text-[#92400e]',
  disabled:       'border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]',
  deferred:       'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]',
  error:          'border-[#fca5a5] bg-[#fef2f2] text-[#dc2626]',
  loading:        'border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]',
}

export function RuntimeStatus() {
  const [state, setState] = useState<NoeticaStatusState>({ state: 'loading' })

  useEffect(() => {
    let cancelled = false
    let failures = 0
    let lastGood: NoeticaStatusState['status'] = undefined

    const poll = () => {
      loadNoeticaStatus()
        .then((status) => {
          if (cancelled) return
          failures = 0
          lastGood = status
          setState({ state: 'ready', status })
        })
        .catch((error) => {
          if (cancelled) return
          failures += 1
          // Tolerate a single transient blip (slow/booting agent-machine) — keep the
          // last-good status (or stay loading) and only flip the badge red after two
          // consecutive failures, so it still catches a real mid-session drop.
          if (failures < 2) {
            setState(lastGood ? { state: 'ready', status: lastGood } : { state: 'loading' })
            return
          }
          setState({ state: 'error', error: error instanceof Error ? error.message : 'status_unavailable' })
        })
    }

    poll()
    // Re-poll so the badge reflects the live runtime — if agent-machine drops
    // mid-session the dot turns red instead of staying stale-green.
    const interval = setInterval(poll, 10_000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (state.state === 'loading') {
    return <StatusShell title="Desktop" items={[['mode', 'loading'], ['runtime', 'loading']]} />
  }

  if (state.state === 'error') {
    return (
      <StatusShell
        title="Desktop"
        items={[['status', 'error'], ['detail', state.error]]}
        tone="error"
        remediations={[
          {
            key: 'status-endpoint',
            label: 'Status endpoint',
            status: 'error',
            owner: 'local-service',
            summary: 'The desktop shell could not read the service status endpoint.',
            command: 'noetica doctor --json'
          }
        ]}
      />
    )
  }

  const status = state.status
  const remediations = buildRuntimeRemediations(status)

  return (
    <StatusShell
      title="Desktop"
      items={[
        ['mode', status.desktop_mode],
        ['runtime', status.endpoint_kind],
        ['provider', status.provider],
        ['sourceos', status.sourceos_route],
        ['agent', status.agent_machine],
        ['mesh', status.prophet_mesh]
      ]}
      tone={status.provider}
      remediations={remediations}
    />
  )
}

function StatusShell({
  title,
  items,
  tone = 'ready',
  remediations = []
}: {
  title: string
  items: Array<[string, string]>
  tone?: NoeticaServiceCapabilityStatus | 'loading' | 'error'
  remediations?: RemediationItem[]
}) {
  const [open, setOpen] = useState(false)
  const toneClass = badgeClassByStatus[tone] ?? badgeClassByStatus.loading
  const visibleRemediations = remediations.slice(0, 3)
  const hasRemediations = visibleRemediations.length > 0
  // Live connection dot: green = ready, red = error/offline, amber = degraded, gray = loading.
  const dotClass =
    tone === 'error' ? 'bg-[#dc2626]'
    : tone === 'loading' ? 'bg-[var(--color-text-tertiary)] animate-pulse'
    : tone === 'not_configured' ? 'bg-[#d97706]'
    : tone === 'ready' ? 'bg-[#16a34a]'
    : 'bg-[#16a34a]'

  return (
    <div className="relative hidden xl:block">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-xs shadow-sm transition ${toneClass}`}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden />
        <span className="font-semibold">{title}</span>
        <dl className="flex items-center gap-2">
          {items.slice(0, 3).map(([label, value]) => (
            <span key={label} className="truncate font-medium text-[var(--color-text-secondary)]">
              {label}:<span className="ml-0.5 text-[var(--color-text-primary)]">{value}</span>
            </span>
          ))}
        </dl>
        {hasRemediations && (
          <span className="rounded-full bg-[var(--color-background-primary)] px-1.5 py-0.5 text-[10px] font-semibold text-[#d97706]">
            {visibleRemediations.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`absolute right-0 top-full z-50 mt-1 w-80 rounded-2xl border shadow-xl ${toneClass} p-3 text-xs`}>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              {items.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-[var(--color-text-tertiary)]">{label}</dt>
                  <dd className="truncate font-medium text-[var(--color-text-primary)]">{value}</dd>
                </div>
              ))}
            </dl>
            {hasRemediations && (
              <div className="mt-2 space-y-1 border-t border-[var(--color-border-secondary)] pt-2">
                {visibleRemediations.map((item) => (
                  <div key={item.key} className="rounded-xl bg-[var(--color-background-primary)] px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--color-text-primary)]">{item.label}</span>
                      <span className="rounded-full bg-[var(--color-background-secondary)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-0.5 leading-snug text-[var(--color-text-secondary)]">{item.summary}</p>
                    {item.command && (
                      <code className="mt-1 block truncate font-mono text-[11px] text-[var(--color-text-primary)]">{item.command}</code>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
