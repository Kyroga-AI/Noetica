import type { SteeringResult } from '@/lib/types/steering'

type SteeringDiffProps = {
  result: SteeringResult
}

export function SteeringDiff({ result }: SteeringDiffProps) {
  return (
    <details className="mt-3 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-3 text-xs text-[var(--color-text-secondary)]">
      <summary className="cursor-pointer font-semibold text-[#1d4ed8]">Steering diff</summary>
      <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#1d4ed8]">
        Status: {result.status}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <div className="font-semibold text-[var(--color-text-primary)]">Baseline</div>
          <p className="mt-1 whitespace-pre-wrap">{result.baseline}</p>
        </div>
        <div>
          <div className="font-semibold text-[var(--color-text-primary)]">Steered</div>
          <p className="mt-1 whitespace-pre-wrap">{result.steered}</p>
        </div>
      </div>
      <p className="mt-3 text-[var(--color-text-secondary)]">{result.diff_summary}</p>
    </details>
  )
}
