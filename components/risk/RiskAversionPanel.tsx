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
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Outcome Observatory</div>
        <div className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          {source}
        </div>
      </div>
      <h2 className="mt-2 text-lg font-semibold text-slate-950">Risk Aversion</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Noetica measures turn-level risk pressure and the response-mode shift it produces. This is behavioral evidence,
        not a hidden-neuron claim for closed hosted models.
      </p>

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Latest turn</div>
            <div className="mt-1 text-sm font-semibold text-slate-950">{latest.label}</div>
          </div>
          <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
            risk {latest.aggregateScore.toFixed(2)}
          </div>
        </div>
        <Meter value={latest.aggregateScore} label="Risk-aversion pressure" />
        <div className="mt-3 text-xs leading-5 text-slate-600">
          Outcome: <span className="font-semibold text-slate-900">{humanize(latest.outcome)}</span>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Dominant dimensions</div>
        {dimensions.map((dimension) => (
          <Meter key={dimension.label} value={dimension.value} label={dimension.label} />
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Observed steering</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {latest.steeringModes.map((mode) => (
            <span key={mode} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
              {humanize(mode)}
            </span>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
          <Metric label="Directness delta" value={latest.directnessDelta} />
          <Metric label="Caution delta" value={latest.cautionDelta} />
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
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
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span>{label}</span>
        <span className="font-semibold text-slate-800">{value.toFixed(2)}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-200">
        <div className="h-2 rounded-full bg-slate-700" style={{ width }} />
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2">
      <div>{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-950">{value.toFixed(2)}</div>
    </div>
  )
}

function humanize(value: string) {
  return value.replace(/_/g, ' ')
}
