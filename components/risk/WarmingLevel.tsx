'use client'

import { useState } from 'react'
import type { RiskAversionLiveReadout } from '@/lib/risk/riskAversionLive'

type Level = 'cool' | 'nominal' | 'elevated' | 'hot' | 'critical'

const THRESHOLDS: [number, Level][] = [
  [0.3, 'critical'],
  [0.2, 'hot'],
  [0.1, 'elevated'],
  [0.04, 'nominal'],
  [0,   'cool'],
]

const LEVEL_META: Record<Level, { label: string; bg: string; border: string; text: string; dot: string; desc: string }> = {
  cool:     { label: 'Cool',     bg: 'bg-[var(--color-background-tertiary)]',   border: 'border-[#cbd5e1]', text: 'text-[var(--color-text-secondary)]', dot: 'bg-[#94a3b8]',  desc: 'No risk pressure detected in the current conversation.' },
  nominal:  { label: 'Nominal',  bg: 'bg-[#f0fdf4]',   border: 'border-[#86efac]', text: 'text-[#16a34a]', dot: 'bg-[#4ade80]',  desc: 'Low risk pressure. Response patterns appear unmodified.' },
  elevated: { label: 'Elevated', bg: 'bg-[#fefce8]',   border: 'border-[#fde047]', text: 'text-[#a16207]', dot: 'bg-[#facc15]',  desc: 'Moderate risk pressure. Some caution or qualification detected.' },
  hot:      { label: 'Hot',      bg: 'bg-[#fff7ed]',   border: 'border-[#fdba74]', text: 'text-[#c2410c]', dot: 'bg-[#f97316]',  desc: 'High risk pressure. Response steering or deflection likely present.' },
  critical: { label: 'Critical', bg: 'bg-[#fef2f2]',   border: 'border-[#fca5a5]', text: 'text-[#b91c1c]', dot: 'bg-[#ef4444]',  desc: 'Critical risk pressure. Strong steering, attribution avoidance, or reframing detected.' },
}

function classifyLevel(score: number): Level {
  for (const [threshold, level] of THRESHOLDS) {
    if (score >= threshold) return level
  }
  return 'cool'
}

type WarmingLevelProps = {
  readout?: RiskAversionLiveReadout | null
  onOpenInspector?: () => void
}

export function WarmingLevel({ readout, onOpenInspector }: WarmingLevelProps) {
  const [expanded, setExpanded] = useState(false)

  const score = readout?.latestTurn.aggregateScore ?? 0
  const level = classifyLevel(score)
  const meta = LEVEL_META[level]
  const topDimension = readout?.dimensions.reduce(
    (a, b) => (b.value > a.value ? b : a),
    { label: '', value: 0 }
  )

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{ border: 'none', background: 'none', outline: 'none' }}
        className="flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-[var(--color-background-secondary)]"
        title={`Risk: ${meta.label}${readout ? ` (${score.toFixed(2)})` : ''} — click for details`}
      >
        <span className={`h-2 w-2 rounded-full ${meta.dot} ${level === 'hot' || level === 'critical' ? 'animate-pulse' : ''}`} />
      </button>

      {expanded && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setExpanded(false)} />
          <div className={`absolute right-0 top-10 z-50 w-72 rounded-2xl border shadow-xl ${meta.bg} ${meta.border} p-4`}>
            <div className="flex items-center justify-between">
              <div className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${meta.text}`}>Warming Level</div>
              <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${meta.border} ${meta.text}`}>
                <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                {meta.label}
              </div>
            </div>

            <p className={`mt-2 text-xs leading-5 ${meta.text} opacity-80`}>{meta.desc}</p>

            {readout && (
              <>
                <div className="mt-3 space-y-2">
                  {readout.dimensions.map((d) => (
                    <div key={d.label} className="flex items-center gap-2">
                      <div className="w-24 shrink-0 text-[11px] text-[var(--color-text-secondary)]">{d.label}</div>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-background-tertiary)]">
                        <div
                          className={`h-full rounded-full transition-all ${
                            d.value >= 0.3 ? 'bg-[#ef4444]' :
                            d.value >= 0.2 ? 'bg-[#f97316]' :
                            d.value >= 0.1 ? 'bg-[#facc15]' :
                            'bg-[#4ade80]'
                          }`}
                          style={{ width: `${Math.min(100, d.value * 100 * 3)}%` }}
                        />
                      </div>
                      <div className="w-8 text-right text-[11px] text-[var(--color-text-secondary)]">{d.value.toFixed(2)}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]/60 p-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">Observed modes</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {readout.latestTurn.steeringModes.map((mode) => (
                      <span key={mode} className="rounded-full bg-[var(--color-background-tertiary)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
                        {mode.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                </div>

                {topDimension && topDimension.value > 0 && (
                  <div className={`mt-3 rounded-xl border p-2.5 text-xs ${meta.border} ${meta.text}`}>
                    Dominant pressure: <span className="font-semibold">{topDimension.label}</span>
                  </div>
                )}
              </>
            )}

            {onOpenInspector && (
              <button
                onClick={() => { setExpanded(false); onOpenInspector() }}
                className="mt-3 w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] py-2 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]"
              >
                Open Observatory →
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
