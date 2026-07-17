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
    <div className="flex items-start gap-[14px] rounded-[14px] border border-[var(--line)] bg-[var(--color-background-secondary)] p-[18px_20px]">
      <span className="mt-1 h-[10px] w-[10px] shrink-0 rounded-full bg-[var(--verified)]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-extrabold text-[var(--color-text-primary)]">{m.id}</span>
          <span className="font-mono text-[11px] bg-[var(--verified-soft)] text-[var(--verified-fg)] px-2 py-[2px] rounded-full">on-device</span>
          <span className="font-mono text-[11px] bg-[var(--color-background-tertiary)] text-[var(--color-text-secondary)] px-2 py-[2px] rounded-full">{fmtParams(m.paramsB)}</span>
          {m.quantization && <span className="font-mono text-[11px] bg-[var(--color-background-tertiary)] text-[var(--color-text-secondary)] px-2 py-[2px] rounded-full">{m.quantization}</span>}
        </div>
        <div className="text-[12px] text-[var(--color-text-tertiary)] mt-[6px] flex gap-[14px] flex-wrap">
          <span>Residency: <b style={{color:'var(--color-text-secondary)'}}>{m.residencyState}</b></span>
          <span>Cache: <b style={{color:'var(--color-text-secondary)'}}>{m.cacheTier}</b></span>
          <span>Carry policy: <b style={{color:'var(--color-text-secondary)'}}>{m.carryPolicy}</b></span>
        </div>
      </div>
    </div>
  )
}

/* ── Adapter card ── */
function AdapterCard({ m }: { m: Model }) {
  return (
    <div className="flex-1 min-w-[160px] rounded-[14px] border border-[var(--line)] bg-[var(--color-background-secondary)] p-[16px_18px] flex flex-col gap-2">
      <div className="flex items-center gap-[7px]">
        <span className="w-2 h-2 rounded-full bg-[var(--violet)]" />
        <span className="text-[13px] font-extrabold text-[var(--color-text-primary)]">{m.lab || m.id}</span>
      </div>
      <div className="font-mono text-[11px] text-[var(--color-text-tertiary)]">{m.id}</div>
      <div className="flex flex-wrap gap-[5px]">
        <span className="font-mono text-[10.5px] bg-[var(--violet-soft)] text-[var(--violet-fg)] px-[7px] py-[2px] rounded-full">adapter</span>
        <span className="font-mono text-[10.5px] bg-[var(--color-background-tertiary)] text-[var(--color-text-tertiary)] px-[7px] py-[2px] rounded-full">{fmtParams(m.paramsB)}</span>
      </div>
      <div className="text-[11px] text-[var(--color-text-tertiary)]">
        Carry: <b style={{color:'var(--color-text-secondary)'}}>{m.carryPolicy}</b>
      </div>
    </div>
  )
}

/* ── Server tier card ── */
function ServerCard({ m }: { m: Model }) {
  return (
    <div className="flex items-start gap-[14px] rounded-[14px] border border-[var(--line)] bg-[var(--color-background-secondary)] p-[18px_20px]">
      <span className="mt-1 h-[10px] w-[10px] shrink-0 rounded-full bg-[var(--violet)]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-extrabold text-[var(--color-text-primary)]">{m.id}</span>
          <span className="font-mono text-[11px] bg-[var(--violet-soft)] text-[var(--violet-fg)] px-2 py-[2px] rounded-full">server</span>
          <span className="font-mono text-[11px] bg-[var(--color-background-tertiary)] text-[var(--color-text-secondary)] px-2 py-[2px] rounded-full">{fmtParams(m.paramsB)}</span>
        </div>
        <div className="text-[12px] text-[var(--color-text-tertiary)] mt-[6px] flex gap-[14px] flex-wrap">
          <span>Provider: <b style={{color:'var(--color-text-secondary)'}}>{m.provider}</b></span>
          <span>Residency: <b style={{color:'var(--color-text-secondary)'}}>{m.residencyState}</b></span>
          <span>Carry policy: <b style={{color:'var(--color-text-secondary)'}}>{m.carryPolicy}</b></span>
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
      <div className="flex h-[50px] shrink-0 items-center gap-[10px] border-b border-[var(--color-border-secondary)] px-[22px]">
        <span className="text-[14px] font-extrabold text-[var(--color-text-primary)]">Labs</span>
        <span className="text-[12px] text-[var(--color-text-tertiary)]">On-device model catalog — read-only</span>
        <div className="flex-1" />
        {isOffline && (
          <div className="flex items-center gap-[6px] rounded-full bg-[var(--pending-soft)] border border-[var(--pending-line)] px-3 py-[5px]">
            <span className="w-[6px] h-[6px] rounded-full bg-[var(--pending)]" />
            <span className="text-[12px] font-bold text-[var(--pending-fg)]">Agent Machine offline — showing demo catalog</span>
          </div>
        )}
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 min-h-0 overflow-y-auto p-[22px] flex flex-col gap-6">
        {!cat && !err ? (
          <div className="text-xs text-[var(--color-text-tertiary)]">Loading...</div>
        ) : (
          <>
            {base && (
              <div>
                <div className="text-[10px] font-bold tracking-[0.6px] text-[var(--color-text-secondary)] uppercase mb-[10px]">On-device base model</div>
                <BaseModelCard m={base} />
              </div>
            )}

            <div>
              <div className="flex items-baseline gap-2 mb-[10px]">
                <span className="text-[10px] font-bold tracking-[0.6px] text-[var(--color-text-secondary)] uppercase">SociOS lab adapters</span>
                <span className="text-[10px] text-[var(--color-text-tertiary)]">opt-in tuning · LoRA</span>
              </div>
              <div className="flex gap-[10px] flex-wrap">
                {adapters.map((m) => <AdapterCard key={m.id} m={m} />)}
              </div>
            </div>

            {server && (
              <div>
                <div className="text-[10px] font-bold tracking-[0.6px] text-[var(--color-text-secondary)] uppercase mb-[10px]">
                  Server tier <span className="font-normal normal-case tracking-normal">larger, off-device</span>
                </div>
                <ServerCard m={server} />
              </div>
            )}

            {/* ── Routing policy strip ── */}
            <div className="bg-[var(--color-background-secondary)] rounded-[14px] border border-[var(--line)] p-[16px_20px] flex flex-col gap-[10px]">
              <div className="text-[10px] font-bold tracking-[0.6px] text-[var(--color-text-secondary)] uppercase">Automatic routing policy</div>
              <div className="flex gap-3 flex-wrap">
                <span className="flex items-center gap-[7px] rounded-full bg-[var(--verified-soft)] border border-[var(--verified-line)] px-[14px] py-[7px]">
                  <span className="w-[7px] h-[7px] rounded-full bg-[var(--verified)]" />
                  <span className="text-[12.5px] font-bold text-[var(--verified-fg)]">High sensitivity → on-device</span>
                </span>
                <span className="flex items-center gap-[7px] rounded-full bg-[var(--pending-soft)] border border-[var(--pending-line)] px-[14px] py-[7px]">
                  <span className="w-[7px] h-[7px] rounded-full bg-[var(--pending)]" />
                  <span className="text-[12.5px] font-bold text-[var(--pending-fg)]">Medium → edge</span>
                </span>
                <span className="flex items-center gap-[7px] rounded-full bg-[var(--violet-soft)] border border-[var(--violet-line)] px-[14px] py-[7px]">
                  <span className="w-[7px] h-[7px] rounded-full bg-[var(--violet)]" />
                  <span className="text-[12.5px] font-bold text-[var(--violet-fg)]">Low sensitivity → server</span>
                </span>
              </div>
              <p className="text-[12px] text-[var(--color-text-tertiary)] leading-[1.6]">
                Routing decisions are made locally before any request leaves the device. Change routing policy in Settings → Runtime.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
