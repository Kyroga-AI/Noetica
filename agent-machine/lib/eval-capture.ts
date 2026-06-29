/**
 * eval-capture.ts — close the online→offline loop: when the grounding-verifier or knowledge-health flags a
 * low-quality output in production, auto-promote that trace into a versioned regression case, replayed on
 * every prompt/model change. We already PRODUCE the failure signal; this captures it into a test.
 *
 * Langfuse sink: when LANGFUSE_SECRET_KEY + LANGFUSE_PUBLIC_KEY are set, captured failures and successes
 * are also shipped as Langfuse scores so the learning loop is observable from the Langfuse dashboard.
 */
import { maybeSinkToLangfuse } from './langfuse-sink.js'

export interface Trace {
  input: string
  output: string
  verified: boolean
  coverage: number
  decision?: string
  independent?: boolean
  traceId?: string
  model?: string
  latencyMs?: number
}
export interface EvalCase { input: string; output: string; failureMode: string; coverage: number; capturedAt: number }

/** Promote a trace to a regression case iff it failed (unverified, thin coverage, or abstained). */
export function captureFailure(trace: Trace, now: number, opts: { minCoverage?: number } = {}): EvalCase | null {
  const minCoverage = opts.minCoverage ?? 0.5
  let failureMode = ''
  if (!trace.verified) failureMode = 'ungrounded'
  else if (trace.coverage < minCoverage) failureMode = 'thin-coverage'
  else if (trace.decision === 'abstain') failureMode = 'abstained'
  if (!failureMode) return null
  const evalCase: EvalCase = { input: trace.input, output: trace.output, failureMode, coverage: trace.coverage, capturedAt: now }
  maybeSinkToLangfuse({
    traceId: trace.traceId ?? `ec-${now}-${Math.random().toString(36).slice(2, 8)}`,
    input: trace.input,
    output: trace.output,
    model: trace.model ?? 'unknown',
    score: trace.coverage,
    label: failureMode,
    comment: `captured failure: ${failureMode}, coverage=${trace.coverage.toFixed(2)}`,
    tags: ['eval-capture', 'failure', failureMode],
    latencyMs: trace.latencyMs,
  })
  return evalCase
}

/** Record a successful trace to Langfuse (procedural-memory wins). */
export function captureProcedural(trace: Trace, now: number): void {
  maybeSinkToLangfuse({
    traceId: trace.traceId ?? `pc-${now}-${Math.random().toString(36).slice(2, 8)}`,
    input: trace.input,
    output: trace.output,
    model: trace.model ?? 'unknown',
    score: trace.coverage,
    label: 'procedural-success',
    comment: `procedural success, coverage=${trace.coverage.toFixed(2)}`,
    tags: ['eval-capture', 'success', 'procedural'],
    latencyMs: trace.latencyMs,
  })
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
