'use client'

import { useEffect, useState } from 'react'
import { loadNoeticaStatus, type NoeticaStatusState } from '@/lib/client/noeticaStatus'
import type { NoeticaServiceCapabilityStatus } from '@/lib/contracts/noeticaService'

const STATUS_COLOR: Record<NoeticaServiceCapabilityStatus | 'loading', string> = {
  ready:          'text-[#16a34a]',
  not_configured: 'text-[#d97706]',
  disabled:       'text-[var(--color-text-tertiary)]',
  deferred:       'text-[#1d4ed8]',
  error:          'text-[#dc2626]',
  loading:        'text-[var(--color-text-tertiary)]',
}

function StatusValue({ value }: { value: string }) {
  const color = STATUS_COLOR[value as NoeticaServiceCapabilityStatus] ?? STATUS_COLOR.loading
  return <span className={`font-semibold ${color}`}>{value}</span>
}

export function SourceOSRailPanel() {
  const [state, setState] = useState<NoeticaStatusState>({ state: 'loading' })

  useEffect(() => {
    let cancelled = false
    loadNoeticaStatus()
      .then((status) => { if (!cancelled) setState({ state: 'ready', status }) })
      .catch((err)   => { if (!cancelled) setState({ state: 'error', error: err instanceof Error ? err.message : 'status_unavailable' }) })
    return () => { cancelled = true }
  }, [])

  const rows: Array<[string, string]> =
    state.state === 'loading'
      ? [
          ['Runtime',       'loading'],
          ['SourceOS route','loading'],
          ['Agent machine', 'loading'],
          ['Prophet mesh',  'loading'],
          ['Policy fabric', 'loading'],
          ['Endpoint',      'loading'],
        ]
      : state.state === 'error'
        ? [
            ['Runtime',       'error'],
            ['Detail',        state.error],
          ]
        : [
            ['Runtime',       state.status.desktop_mode],
            ['SourceOS route',state.status.sourceos_route],
            ['Agent machine', state.status.agent_machine],
            ['Prophet mesh',  state.status.prophet_mesh],
            ['Policy fabric', state.status.steer],
            ['Endpoint',      state.status.endpoint_kind],
          ]

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border-secondary)] px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">SourceOS</div>
        <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Native substrate status</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between text-xs">
            <span className="text-[var(--color-text-secondary)]">{label}</span>
            <StatusValue value={value} />
          </div>
        ))}

        {state.state === 'ready' && state.status.notes && state.status.notes.length > 0 && (
          <div className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 space-y-1">
            {state.status.notes.map((note, i) => (
              <p key={i} className="text-[10px] leading-relaxed text-[var(--color-text-tertiary)]">{note}</p>
            ))}
          </div>
        )}

        <div className="pt-3 space-y-1.5">
          {['Open graph explorer', 'Open event ledger', 'Replay view', 'Export'].map((action) => (
            <button key={action} className="w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-left text-xs text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]">
              {action}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
