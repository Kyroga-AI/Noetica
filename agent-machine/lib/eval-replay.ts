/**
 * eval-replay — the consumer side of the learning flywheel.
 *
 * eval-capture writes production FAILURES to ~/.noetica/eval-cases.jsonl. This re-runs those captured
 * failures against the CURRENT system (today's retrieval + model + skills, or a freshly-promoted
 * adapter) and reports how many now pass — "fixed X of N of your real failures, 0 regressed". That
 * turns the loop's improvement from an invisible internal number into a felt, on-screen win, and is
 * the receipt the cloud-mesh-proof motion needs.
 *
 * The regenerate + judge functions are injected, so the harness is pure and unit-testable without a
 * model or retrieval.
 */
import type { EvalCase } from './eval-capture.js'

export interface ReplayOutcome {
  input: string
  failureMode: string
  priorCoverage: number
  nowGrounded: boolean
  nowScore: number
  fixed: boolean
}

export interface ReplaySummary {
  total: number
  fixed: number
  stillFailing: number
  fixedRate: number
  ts: number
  outcomes: ReplayOutcome[]
}

/** Parse the eval-cases JSONL (tolerant — skips malformed / inputless lines). */
export function parseEvalCases(text: string): EvalCase[] {
  const out: EvalCase[] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const c = JSON.parse(t) as Partial<EvalCase>
      if (c && typeof c.input === 'string' && c.input.trim()) {
        out.push({ input: c.input, output: c.output ?? '', failureMode: c.failureMode ?? 'unknown', coverage: Number(c.coverage ?? 0), capturedAt: Number(c.capturedAt ?? 0) })
      }
    } catch {
      /* skip malformed line */
    }
  }
  return out
}

/** Most-recent-first dedupe by normalized input, capped — bounds replay cost + avoids re-scoring dups. */
export function selectForReplay(cases: EvalCase[], cap: number): EvalCase[] {
  const seen = new Set<string>()
  const sel: EvalCase[] = []
  for (let i = cases.length - 1; i >= 0 && sel.length < cap; i--) {
    const c = cases[i]!
    const k = c.input.trim().toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    sel.push(c)
  }
  return sel
}

/**
 * Replay one captured failure: regenerate with the current system + re-judge grounding. "fixed" iff
 * it now grounds (where it previously failed). A regeneration error counts as still-failing.
 */
export async function replayCase(
  c: EvalCase,
  regenerate: (input: string) => Promise<{ answer: string; sources: { text: string }[] }>,
  judge: (answer: string, sources: { text: string }[]) => { grounded: boolean; score: number },
): Promise<ReplayOutcome> {
  let nowGrounded = false
  let nowScore = 0
  try {
    const { answer, sources } = await regenerate(c.input)
    const r = judge(answer, sources)
    nowGrounded = r.grounded
    nowScore = r.score
  } catch {
    /* a regeneration/judge failure means it is still failing */
  }
  return {
    input: c.input.slice(0, 120),
    failureMode: c.failureMode,
    priorCoverage: c.coverage,
    nowGrounded,
    nowScore,
    fixed: nowGrounded,
  }
}

export function summarizeReplay(outcomes: ReplayOutcome[], now: number): ReplaySummary {
  const total = outcomes.length
  const fixed = outcomes.filter((o) => o.fixed).length
  return { total, fixed, stillFailing: total - fixed, fixedRate: total ? fixed / total : 0, ts: now, outcomes }
}
