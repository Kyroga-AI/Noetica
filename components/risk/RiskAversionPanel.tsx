'use client'

import { riskAversionDemoDimensions, riskAversionDemoTurns } from '@/lib/risk/riskAversionDemo'
import type { RiskAversionLiveReadout } from '@/lib/risk/riskAversionLive'

type RiskAversionPanelProps = {
  readout?: RiskAversionLiveReadout | null
}

export function RiskAversionPanel({ readout }: RiskAversionPanelProps) {
  const latest = readout?.latestTurn ?? riskAversionDemoTurns[riskAversionDemoTurns.length - 1]
  const dimensions = readout?.dimensions ?? riskAversionDemoDimensions
  const source = readout?.source ?? 'fallback'

  return (
    <div className="mt-4 rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-text-tertiary)]">Outcome Observatory</div>
        <div className="rounded-full bg-[var(--color-background-tertiary)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
          {source}
        </div>
      </div>
      <h2 className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">Risk Aversion</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
        Noetica measures turn-level risk pressure and the response-mode shift it produces. This is behavioral evidence,
        not a hidden-neuron claim for closed hosted models.
      </p>

      <div className="mt-4 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">Latest turn</div>
            <div className="mt-1 text-sm font-semibold text-[var(--color-text-primary)]">{latest.label}</div>
          </div>
          <div className="rounded-full border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1 text-xs font-semibold text-[var(--color-text-secondary)]">
            risk {latest.aggregateScore.toFixed(2)}
          </div>
        </div>
        <Meter value={latest.aggregateScore} label="Risk-aversion pressure" />
        <div className="mt-3 text-xs leading-5 text-[var(--color-text-secondary)]">
          Outcome: <span className="font-semibold text-[var(--color-text-primary)]">{humanize(latest.outcome)}</span>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">Dominant dimensions</div>
        {dimensions.map((dimension) => (
          <Meter key={dimension.label} value={dimension.value} label={dimension.label} />
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-[var(--color-border-secondary)] p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">Observed steering</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {latest.steeringModes.map((mode) => (
            <span key={mode} className="rounded-full bg-[var(--color-background-tertiary)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)]">
              {humanize(mode)}
            </span>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--color-text-secondary)]">
          <Metric label="Directness delta" value={latest.directnessDelta} />
          <Metric label="Caution delta" value={latest.cautionDelta} />
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[#fef08a] bg-[#fefce8] p-3 text-xs leading-5 text-[#713f12]">
        Use this as a risk-aversion readout: liability and attribution pressure can produce caution, evidence demands,
        attribution avoidance, or hypothesis reframing. Counterfactual replay is required before calling a transition replicated.
      </div>
    </div>
  )
}

function Meter({ label, value }: { label: string; value: number }) {
  const width = `${Math.max(0, Math.min(1, value)) * 100}%`

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
        <span>{label}</span>
        <span className="font-semibold text-[var(--color-text-primary)]">{value.toFixed(2)}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-[var(--color-background-tertiary)]">
        <div className="h-2 rounded-full bg-[var(--color-text-secondary)]" style={{ width }} />
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-[var(--color-background-secondary)] p-2">
      <div className="text-xs text-[var(--color-text-secondary)]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[var(--color-text-primary)]">{value.toFixed(2)}</div>
    </div>
  )
}

function humanize(value: string) {
  return value.replace(/_/g, ' ')
}
