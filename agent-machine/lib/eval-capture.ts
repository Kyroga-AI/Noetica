/**
 * eval-capture.ts — close the online→offline loop: when the grounding-verifier or knowledge-health flags a
 * low-quality output in production, auto-promote that trace into a versioned regression case, replayed on
 * every prompt/model change. We already PRODUCE the failure signal; this captures it into a test.
 */
export interface Trace { input: string; output: string; verified: boolean; coverage: number; decision?: string; independent?: boolean }
export interface EvalCase { input: string; output: string; failureMode: string; coverage: number; capturedAt: number }

/** Promote a trace to a regression case iff it failed (unverified, thin coverage, or abstained). */
export function captureFailure(trace: Trace, now: number, opts: { minCoverage?: number } = {}): EvalCase | null {
  const minCoverage = opts.minCoverage ?? 0.5
  let failureMode = ''
  if (!trace.verified) failureMode = 'ungrounded'
  else if (trace.coverage < minCoverage) failureMode = 'thin-coverage'
  else if (trace.decision === 'abstain') failureMode = 'abstained'
  if (!failureMode) return null
  return { input: trace.input, output: trace.output, failureMode, coverage: trace.coverage, capturedAt: now }
}

/** Dedupe captured cases by normalized input, keeping the most recent. */
export function dedupeCases(cases: EvalCase[]): EvalCase[] {
  const byInput = new Map<string, EvalCase>()
  for (const c of cases) {
    const k = c.input.trim().toLowerCase()
    const prev = byInput.get(k)
    if (!prev || c.capturedAt > prev.capturedAt) byInput.set(k, c)
  }
  return [...byInput.values()]
}
