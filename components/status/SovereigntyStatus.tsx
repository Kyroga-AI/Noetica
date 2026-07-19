'use client'

import { useEffect, useState } from 'react'
import { amUrl } from '@/lib/tauri/bridge'
import { loadNoeticaStatus, type NoeticaStatusState } from '@/lib/client/noeticaStatus'
import type { RiskAversionLiveReadout } from '@/lib/risk/riskAversionLive'

// One health affordance for the topbar — consolidates the three separate always-on pills
// (egress · runtime · risk) into a single indicator. Egress leads (it's the sovereignty moat);
// runtime + risk detail live in the expand. Replaces EgressMeter + RuntimeStatus + WarmingLevel.

type RiskLevel = 'cool' | 'nominal' | 'elevated' | 'hot' | 'critical'
function classifyRisk(score: number): RiskLevel {
  if (score >= 0.3) return 'critical'
  if (score >= 0.2) return 'hot'
  if (score >= 0.1) return 'elevated'
  if (score >= 0.04) return 'nominal'
  return 'cool'
}
const RISK_META: Record<RiskLevel, { label: string; dot: string; desc: string }> = {
  cool:     { label: 'Cool',     dot: 'bg-[#94a3b8]', desc: 'No risk pressure detected.' },
  nominal:  { label: 'Nominal',  dot: 'bg-[#4ade80]', desc: 'Low risk pressure; responses appear unmodified.' },
  elevated: { label: 'Elevated', dot: 'bg-[#facc15]', desc: 'Moderate pressure; some caution/qualification detected.' },
  hot:      { label: 'Hot',      dot: 'bg-[#f97316]', desc: 'High pressure; steering or deflection likely.' },
  critical: { label: 'Critical', dot: 'bg-[#ef4444]', desc: 'Critical pressure; strong steering detected.' },
}

type Props = {
  riskReadout?: RiskAversionLiveReadout | null
  onOpenInspector?: () => void
}

export function SovereigntyStatus({ riskReadout, onOpenInspector }: Props) {
  const [egress, setEgress] = useState<number | null>(null)
  const [runtime, setRuntime] = useState<NoeticaStatusState>({ state: 'loading' })
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const pollEgress = async () => {
      try {
        const r = await fetch(amUrl('/api/governance/recent?limit=50'))
        if (!r.ok) return
        const j = (await r.json()) as { runs?: Array<{ tokens_egressed?: number }> }
        const total = (j.runs ?? []).reduce((s, x) => s + (x.tokens_egressed ?? 0), 0)
        if (!cancelled) setEgress(total)
      } catch { /* offline — keep last */ }
    }
    const pollRuntime = () => {
      loadNoeticaStatus()
        .then((status) => { if (!cancelled) setRuntime({ state: 'ready', status }) })
        .catch((err)   => { if (!cancelled) setRuntime({ state: 'error', error: err instanceof Error ? err.message : 'status_unavailable' }) })
    }
    void pollEgress(); pollRuntime()
    const id = setInterval(() => { void pollEgress(); pollRuntime() }, 10_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const sovereign = egress === 0 || egress === null
  const riskScore = riskReadout?.latestTurn.aggregateScore ?? 0
  const risk = classifyRisk(riskScore)
  const runtimeOk = runtime.state === 'ready'
  // The single dot = worst of runtime/risk (egress carries its own color in the label).
  const healthDot = runtime.state === 'error' ? 'bg-[#ef4444]'
    : (risk === 'hot' || risk === 'critical') ? RISK_META[risk].dot
    : runtimeOk ? 'bg-[#16a34a]' : 'bg-[var(--color-text-tertiary)]'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Sovereignty & runtime health"
        className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition md:inline-flex ${
          sovereign ? 'border-[#86efac] bg-[#dcfce7] text-[#16a34a]' : 'border-[#fde68a] bg-[#fef9c3] text-[#92400e]'
        }`}
      >
        <span aria-hidden>{sovereign ? '🔒' : '↗'}</span>
        {sovereign ? 'on-device' : `${egress!.toLocaleString()} out`}
        <span className={`ml-0.5 h-1.5 w-1.5 rounded-full ${healthDot}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-3 shadow-lg">
            {/* Sovereignty / egress */}
            <div className="mb-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">Sovereignty</div>
              <div className="mt-1 flex items-center gap-2 text-xs">
                <span aria-hidden>{sovereign ? '🔒' : '↗'}</span>
                <span className="text-[var(--color-text-primary)]">
                  {sovereign ? 'Zero egress — nothing has left this device.' : `${egress!.toLocaleString()} tokens routed off-device (under your scope-d gate).`}
                </span>
              </div>
            </div>
            {/* Runtime */}
            <div className="mb-2.5 border-t border-[var(--color-border-tertiary)] pt-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">Runtime</div>
              {runtime.state === 'ready' ? (
                <div className="mt-1 space-y-0.5 text-xs text-[var(--color-text-secondary)]">
                  <div className="flex justify-between"><span className="text-[var(--color-text-tertiary)]">mode</span><span>{runtime.status.desktop_mode || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-[var(--color-text-tertiary)]">endpoint</span><span>{runtime.status.endpoint_kind || '—'}</span></div>
                </div>
              ) : runtime.state === 'error' ? (
                <div className="mt-1 text-xs text-[#dc2626]">Status endpoint unreachable</div>
              ) : (
                <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">starting…</div>
              )}
            </div>
            {/* Risk */}
            <div className="border-t border-[var(--color-border-tertiary)] pt-2.5">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">Risk pressure</div>
                <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                  <span className={`h-1.5 w-1.5 rounded-full ${RISK_META[risk].dot}`} />{RISK_META[risk].label}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">{RISK_META[risk].desc}</p>
              {onOpenInspector && (
                <button
                  onClick={() => { setOpen(false); onOpenInspector() }}
                  className="mt-1.5 text-[11px] font-medium text-[var(--color-accent,#7c8cf8)] transition hover:underline">
                  Open risk inspector →
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
