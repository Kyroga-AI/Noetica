import type { SteeringResult } from '@/lib/types/steering'

type SteeringDiffProps = {
  result: SteeringResult
}

export function SteeringDiff({ result }: SteeringDiffProps) {
  return (
    <details className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-slate-700">
      <summary className="cursor-pointer font-semibold text-blue-700">Steering diff</summary>
      <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
        Status: {result.status}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <div className="font-semibold text-slate-900">Baseline</div>
          <p className="mt-1 whitespace-pre-wrap">{result.baseline}</p>
        </div>
        <div>
          <div className="font-semibold text-slate-900">Steered</div>
          <p className="mt-1 whitespace-pre-wrap">{result.steered}</p>
        </div>
      </div>
      <p className="mt-3 text-slate-600">{result.diff_summary}</p>
    </details>
  )
}
