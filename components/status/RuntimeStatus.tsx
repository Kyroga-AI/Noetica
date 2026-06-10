'use client'

'use client'

import { useEffect, useState } from 'react'
import { loadNoeticaStatus, type NoeticaStatusState } from '@/lib/client/noeticaStatus'
import { buildRuntimeRemediations, type RemediationItem } from '@/lib/client/remediation'
import type { NoeticaServiceCapabilityStatus } from '@/lib/contracts/noeticaService'

const badgeClassByStatus: Record<NoeticaServiceCapabilityStatus | 'loading' | 'error', string> = {
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  not_configured: 'border-amber-200 bg-amber-50 text-amber-700',
  disabled: 'border-slate-200 bg-slate-50 text-slate-600',
  deferred: 'border-blue-200 bg-blue-50 text-blue-700',
  error: 'border-rose-200 bg-rose-50 text-rose-700',
  loading: 'border-slate-200 bg-slate-50 text-slate-600'
}

export function RuntimeStatus() {
  const [state, setState] = useState<NoeticaStatusState>({ state: 'loading' })

  useEffect(() => {
    let cancelled = false

    loadNoeticaStatus()
      .then((status) => {
        if (!cancelled) setState({ state: 'ready', status })
      })
      .catch((error) => {
        if (!cancelled) setState({ state: 'error', error: error instanceof Error ? error.message : 'status_unavailable' })
      })

    return () => {
      cancelled = true
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

  return (
    <div className="relative hidden xl:block">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-xs shadow-sm transition ${toneClass}`}
      >
        <span className="font-semibold">{title}</span>
        <dl className="flex items-center gap-2">
          {items.slice(0, 3).map(([label, value]) => (
            <span key={label} className="truncate font-medium text-slate-700">
              {label}:<span className="ml-0.5 text-slate-900">{value}</span>
            </span>
          ))}
        </dl>
        {hasRemediations && (
          <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
            {visibleRemediations.length}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* popover */}
          <div className={`absolute right-0 top-full z-50 mt-1 w-80 rounded-2xl border shadow-xl ${toneClass} p-3 text-xs`}>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              {items.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="truncate font-medium text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>
            {hasRemediations && (
              <div className="mt-2 space-y-1 border-t border-white/70 pt-2">
                {visibleRemediations.map((item) => (
                  <div key={item.key} className="rounded-xl bg-white/60 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800">{item.label}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-0.5 leading-snug text-slate-600">{item.summary}</p>
                    {item.command && (
                      <code className="mt-1 block truncate text-[11px] text-slate-800">{item.command}</code>
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
