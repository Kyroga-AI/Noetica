'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * AI·Models → Labs — the model catalog, Apple-aligned + sourceos-spec-conformant.
 * One ~3B on-device base + swappable per-lab LoRA adapters (the SociOS opt-in tuning labs) + a larger
 * server tier, routed by sensitivity (high stays on-device — Apple's privacy tier).
 */

const amBase = () =>
  typeof window !== 'undefined' && (window as unknown as { __TAURI__?: unknown }).__TAURI__ ? 'http://127.0.0.1:8080' : ''

type Model = {
  id: string; kind: 'base' | 'adapter'; modality?: string; lab?: string
  tier: 'on-device' | 'edge' | 'server'; paramsB: number; quantization?: string
  residencyState: string; cacheTier: string; carryPolicy: string; provider: string
}
type Catalog = { models: Model[]; note: string }

const TIER_COLOR: Record<Model['tier'], string> = { 'on-device': '#16a34a', edge: '#d97706', server: 'var(--accent)' }
const fmtParams = (b: number) => (b >= 1 ? `${b}B` : `${Math.round(b * 1000)}M`)

function ModelCard({ m }: { m: Model }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: TIER_COLOR[m.tier] }} />
        <span className="truncate text-xs font-semibold text-[var(--color-text-primary)]">{m.modality ? `${m.modality} adapter` : m.id}</span>
        <span className="ml-auto shrink-0 rounded bg-[var(--color-background-secondary)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--color-text-secondary)]">{fmtParams(m.paramsB)}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1 text-[9px] text-[var(--color-text-tertiary)]">
        <span className="rounded bg-[var(--color-background-secondary)] px-1.5 py-0.5">{m.tier}</span>
        {m.quantization && <span className="rounded bg-[var(--color-background-secondary)] px-1.5 py-0.5">{m.quantization}</span>}
        <span className="rounded bg-[var(--color-background-secondary)] px-1.5 py-0.5">{m.residencyState}</span>
        <span className="rounded bg-[var(--color-background-secondary)] px-1.5 py-0.5">{m.provider}</span>
        {m.lab && <span className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[var(--accent)]">{m.lab}</span>}
      </div>
    </div>
  )
}

export function LabsSurface() {
  const [cat, setCat] = useState<Catalog | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    setErr('')
    try {
      const res = await fetch(`${amBase()}/api/labs/catalog`)
      if (!res.ok) throw new Error(`labs ${res.status}`)
      setCat((await res.json()) as Catalog)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not reach agent-machine backend') }
  }, [])
  useEffect(() => { void load() }, [load])

  const base = cat?.models.find((m) => m.kind === 'base' && m.tier === 'on-device')
  const adapters = cat?.models.filter((m) => m.kind === 'adapter') ?? []
  const server = cat?.models.find((m) => m.tier === 'server')

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div>
          <div className="text-lg font-semibold text-[var(--color-text-primary)]">Labs · Model Catalog</div>
          <div className="text-xs text-[var(--color-text-secondary)]">Apple-aligned: one on-device base + swappable per-lab LoRA adapters + a server tier. Routed by sensitivity — high stays on-device.</div>
        </div>

        {err ? <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-2 text-xs text-[#dc2626]">{err} — run under dev:app</div>
          : !cat ? <div className="text-xs text-[var(--color-text-tertiary)]">Loading…</div>
          : (
            <>
              {base && (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">On-device base</div>
                  <ModelCard m={base} />
                </div>
              )}
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">SociOS lab adapters (opt-in tuning · LoRA)</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {adapters.map((m) => <ModelCard key={m.id} m={m} />)}
                </div>
              </div>
              {server && (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">Server tier (larger · off-device)</div>
                  <ModelCard m={server} />
                </div>
              )}
              <div className="rounded-xl bg-[var(--color-background-secondary)] px-3 py-2 text-[10px] text-[var(--color-text-secondary)]">
                Routing (isolation ↔ residency): <strong className="text-[#16a34a]">high → on-device</strong> · <strong className="text-[#d97706]">medium → edge</strong> · <strong className="text-[var(--accent)]">low → server</strong>. {cat.note}
              </div>
            </>
          )}
      </div>
    </div>
  )
}
