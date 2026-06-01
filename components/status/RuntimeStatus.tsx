'use client'

import { useEffect, useState } from 'react'
import { loadNoeticaStatus, type NoeticaStatusState } from '@/lib/client/noeticaStatus'
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
    return <StatusShell title="Desktop" items={[['status', 'error'], ['detail', state.error]]} tone="error" />
  }

  const status = state.status

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
    />
  )
}

function StatusShell({
  title,
  items,
  tone = 'ready'
}: {
  title: string
  items: Array<[string, string]>
  tone?: NoeticaServiceCapabilityStatus | 'loading' | 'error'
}) {
  const toneClass = badgeClassByStatus[tone] ?? badgeClassByStatus.loading

  return (
    <div className={`hidden min-w-[280px] rounded-2xl border px-3 py-2 text-xs shadow-sm xl:block ${toneClass}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-semibold">{title}</span>
        <span className="rounded-full bg-white/70 px-2 py-0.5 font-medium">status</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        {items.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-500">{label}</dt>
            <dd className="truncate font-medium text-slate-800">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
