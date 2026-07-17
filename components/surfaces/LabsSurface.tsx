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

const TIER_COLOR: Record<Model['tier'], string> = { 'on-device': '#16a34a', edge: '#d97706', server: '#7c3aed' }
const fmtParams = (b: number) => (b >= 1 ? `${b}B` : `${Math.round(b * 1000)}M`)

/* ── Base model card (large, side-by-side layout) ── */
function BaseModelCard({ m }: { m: Model }) {
  return (
    <div className="flex gap-3 rounded-[14px] border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-5 py-[18px]">
      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#16a34a]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-extrabold text-[var(--color-text-primary)]">{m.id}</span>
          <span className="ml-auto shrink-0 rounded bg-[var(--color-background-secondary)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--color-text-secondary)]">{fmtParams(m.paramsB)}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 font-mono text-[11px] text-[#16a34a]">on-device</span>
          {m.quantization && <span className="rounded-full bg-[var(--color-background-secondary)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-tertiary)]">{m.quantization}</span>}
          <span className="rounded-full bg-[var(--color-background-secondary)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-tertiary)]">{m.provider}</span>
        </div>
        <div className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
          Residency: <strong className="text-[var(--color-text-primary)]">{m.residencyState}</strong> · Cache: <strong className="text-[var(--color-text-primary)]">{m.cacheTier}</strong> · Carry policy: <strong className="text-[var(--color-text-primary)]">{m.carryPolicy}</strong>
        </div>
      </div>
    </div>
  )
}

/* ── Adapter card ── */
function AdapterCard({ m }: { m: Model }) {
  return (
    <div className="min-w-[160px] flex-1 rounded-[14px] border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#7c3aed]" />
        <span className="truncate text-sm font-extrabold text-[var(--color-text-primary)]">{m.modality ? `${m.modality} adapter` : m.id}</span>
        <span className="ml-auto shrink-0 rounded bg-[var(--color-background-secondary)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--color-text-secondary)]">{fmtParams(m.paramsB)}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <span className="rounded-full bg-[#ede9fe] px-2 py-0.5 font-mono text-[11px] text-[#7c3aed]">adapter</span>
        {m.quantization && <span className="rounded-full bg-[var(--color-background-secondary)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-tertiary)]">{m.quantization}</span>}
        <span className="rounded-full bg-[var(--color-background-secondary)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-tertiary)]">{m.residencyState}</span>
        <span className="rounded-full bg-[var(--color-background-secondary)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-tertiary)]">{m.provider}</span>
        {m.lab && <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[11px] text-[var(--accent)]">{m.lab}</span>}
      </div>
      <div className="mt-1.5 text-[11px] text-[var(--color-text-secondary)]">
        Carry policy: <strong className="text-[var(--color-text-primary)]">{m.carryPolicy}</strong>
      </div>
    </div>
  )
}

/* ── Server tier card ── */
function ServerCard({ m }: { m: Model }) {
  return (
    <div className="flex gap-3 rounded-[14px] border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-5 py-[18px]">
      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#7c3aed]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-extrabold text-[var(--color-text-primary)]">{m.id}</span>
          <span className="rounded-full bg-[#ede9fe] px-2 py-0.5 font-mono text-[11px] text-[#7c3aed]">server</span>
          <span className="ml-auto shrink-0 rounded bg-[var(--color-background-secondary)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--color-text-secondary)]">{fmtParams(m.paramsB)}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {m.quantization && <span className="rounded-full bg-[var(--color-background-secondary)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-tertiary)]">{m.quantization}</span>}
          <span className="rounded-full bg-[var(--color-background-secondary)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-tertiary)]">{m.provider}</span>
        </div>
        <div className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
          Residency: <strong className="text-[var(--color-text-primary)]">{m.residencyState}</strong> · Cache: <strong className="text-[var(--color-text-primary)]">{m.cacheTier}</strong> · Carry policy: <strong className="text-[var(--color-text-primary)]">{m.carryPolicy}</strong>
        </div>
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

  const isOffline = !!err

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── Fixed topbar ── */}
      <div className="flex h-[50px] shrink-0 items-center gap-2.5 border-b border-[var(--color-border-secondary)] px-6">
        <span className="text-sm font-extrabold text-[var(--color-text-primary)]">Labs</span>
        <span className="text-xs text-[var(--color-text-tertiary)]">On-device model catalog — read-only</span>
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
        {/* Offline banner */}
        {isOffline && (
          <div className="flex items-center gap-2.5 rounded-[10px] border border-[#FCD34D] bg-[#FEF3C7] px-3 py-2">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#F59E0B] opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#F59E0B]" />
            </span>
            <span className="text-xs font-medium text-[#92400E]">Agent Machine offline — showing demo catalog</span>
          </div>
        )}

        {!cat && !err ? (
          <div className="text-xs text-[var(--color-text-tertiary)]">Loading...</div>
        ) : (
          <>
            {base && (
              <div>
                <div className="mb-[10px] text-[10px] font-bold uppercase tracking-[0.6px] text-[var(--color-text-tertiary)]">On-device base model</div>
                <BaseModelCard m={base} />
              </div>
            )}

            <div>
              <div className="mb-[10px] text-[10px] font-bold uppercase tracking-[0.6px] text-[var(--color-text-tertiary)]">
                SociOS lab adapters <span className="font-normal normal-case tracking-normal">opt-in tuning via LoRA</span>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {adapters.map((m) => <AdapterCard key={m.id} m={m} />)}
              </div>
            </div>

            {server && (
              <div>
                <div className="mb-[10px] text-[10px] font-bold uppercase tracking-[0.6px] text-[var(--color-text-tertiary)]">
                  Server tier <span className="font-normal normal-case tracking-normal">larger, off-device</span>
                </div>
                <ServerCard m={server} />
              </div>
            )}

            {/* ── Routing policy strip ── */}
            <div className="rounded-[14px] border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-5 py-4">
              <div className="mb-[10px] text-[10px] font-bold uppercase tracking-[0.6px] text-[var(--color-text-tertiary)]">Routing policy</div>
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#86efac] bg-[#dcfce7] px-3.5 py-[7px] text-[12.5px] font-bold text-[#16a34a]">
                  <span className="h-[7px] w-[7px] rounded-full bg-[#16a34a]" />
                  High sensitivity → on-device
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FCD34D] bg-[#FEF3C7] px-3.5 py-[7px] text-[12.5px] font-bold text-[#92400E]">
                  <span className="h-[7px] w-[7px] rounded-full bg-[#d97706]" />
                  Medium → edge
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#c4b5fd] bg-[#ede9fe] px-3.5 py-[7px] text-[12.5px] font-bold text-[#7c3aed]">
                  <span className="h-[7px] w-[7px] rounded-full bg-[#7c3aed]" />
                  Low sensitivity → server
                </span>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
                Routing decisions are made locally before any request leaves the device. Change routing policy in Settings → Runtime.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
