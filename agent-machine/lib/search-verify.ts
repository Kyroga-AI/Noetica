/**
 * search-verify — the generate-and-verify lane for the NP-shaped `search-verify` posture
 * (find / construct / smallest / largest / optimal / counterexample / "such that").
 *
 * The moat doctrine's load-bearing asymmetry: for this posture VERIFYING a candidate is
 * cheaper and more trustworthy than GENERATING one (verification ≠ generation). Plain
 * best-of-N has no verify step — it votes over guesses. This lane instead:
 *   1. GENERATES a candidate by CoT (reusing the free-form reason prompt: step-by-step
 *      reasoning → a single parseable "FINAL: <candidate>" line),
 *   2. VERIFIES the candidate against the problem's stated constraints, and
 *   3. on failure REGENERATES — feeding the failure reason back (verify-guided retry) —
 *      up to maxAttempts.
 *
 * Two verification modes, surfaced as a flag the caller uses to classify evidence:
 *   • 'executable' — a deterministic check (plug the candidate back into the constraints
 *     and run it). A PASS here is trustworthy and replay-EXACT.
 *   • 'model'      — a model-judged "does <candidate> satisfy <constraints>? YES/NO".
 *     A PASS here is only best-effort.
 *
 * The `verify` function is INJECTED so the loop is unit-testable with a fake (no model,
 * no sandbox). Safe-trace: the caller gets STRUCTURED FLAGS only — the candidate/verify
 * prose never needs to enter an evidence summary.
 *
 * Pure + dependency-injected; exception handling is the caller's job (server wraps the
 * whole lane in try/catch and falls through to best-of-N), but this module never throws
 * on a verify miss — it returns the best unverified candidate so the turn is never blocked.
 */

import { extractFinal } from './reason-lane.js'

/** The outcome of verifying ONE candidate. `mode` tells the caller how to classify the
 *  evidence: an executable PASS is replay-exact, a model PASS is best-effort. `reason` is
 *  the (short) failure/justification text fed back into the next generation on a miss —
 *  it is for retry guidance only and must NOT be copied into any evidence summary. */
export interface VerifyResult {
  pass: boolean
  /** Which verifier decided this — executable (deterministic) vs model-judged. */
  mode: 'executable' | 'model'
  /** Short why (a failed-constraint description / YES-NO justification). Retry-guidance only. */
  reason?: string
}

export interface SearchVerifyResult {
  /** The chosen candidate's free-form answer (the FINAL value), best of what we found. */
  candidate: string
  /** The full winning sample text (CoT + FINAL) — the caller streams this; keep it OUT of evidence. */
  content: string
  /** Did the chosen candidate pass verification? */
  verified: boolean
  /** Which verifier passed it (only meaningful when verified=true). Drives exact vs best-effort. */
  verifyMode: 'executable' | 'model' | null
  /** How many candidates were generated (1..maxAttempts). */
  attempts: number
}

export interface SearchVerifyParams {
  question: string
  /** Generate the i-th CoT candidate. `priorFailure` (if set) is the previous miss's reason,
   *  to fold into the prompt for a verify-guided retry. Returns the full sample text. */
  sample: (sampleIdx: number, priorFailure?: string) => Promise<string>
  /** Verify a candidate against the question's constraints. INJECTED so the loop is testable
   *  without a model/sandbox. Returns pass/fail + the mode + a short reason. */
  verify: (candidate: string, question: string) => Promise<VerifyResult>
  /** (Unused placeholder for symmetry with reason-lane K; candidates are sequential.) */
  k?: number
  /** Max generate→verify rounds before returning the best unverified candidate. Default 3. */
  maxAttempts?: number
}

/** Is the search-verify lane enabled? Default ON — it only ADDS a verify step to a posture
 *  that currently has none and falls back gracefully. NOETICA_SEARCH_VERIFY=0 disables it. */
export function searchVerifyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env['NOETICA_SEARCH_VERIFY'] !== '0'
}

/**
 * The free-form CoT generation rule for a candidate — mirrors reason-lane's REASON_RULE so a
 * non-reasoning model engages step-by-step and ends on a parseable FINAL line we can extract.
 * On a retry, the prior verification failure is folded in so the model corrects rather than repeats.
 */
export function candidatePrompt(question: string, priorFailure?: string): string {
  const base = `${question}\n\nWork through this step by step, showing your reasoning. Then output your candidate answer on its own last line, starting with "FINAL:".`
  if (!priorFailure) return base
  return `${base}\n\nYour previous candidate FAILED verification:\n${priorFailure}\nProduce a corrected candidate that satisfies the stated constraints.`
}

/** Pull the candidate value out of a CoT sample (the text after the last FINAL: line). Falls
 *  back to the last non-empty line so a sample that forgot the marker still yields a candidate. */
export function extractCandidate(raw: string): string | null {
  const final = extractFinal(raw)
  if (final) return final
  const lines = String(raw ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return lines.length ? lines[lines.length - 1]!.slice(0, 400) : null
}

/**
 * Generate → verify → (verify-guided) retry. Returns the verified candidate when one passes,
 * otherwise the best (most-complete) candidate with verified:false so the turn is never blocked.
 *
 * Never throws on a verify miss; a thrown verify/sample (model/sandbox hiccup) for one attempt is
 * swallowed and treated as a miss so the loop proceeds — the caller still gets a usable candidate.
 */
export async function runSearchVerify(params: SearchVerifyParams): Promise<SearchVerifyResult | null> {
  const maxAttempts = Math.max(1, Math.floor(params.maxAttempts ?? 3))
  let priorFailure: string | undefined
  let best: { candidate: string; content: string } | null = null
  let attempts = 0

  for (let i = 0; i < maxAttempts; i++) {
    attempts = i + 1
    let raw: string
    try { raw = await params.sample(i, priorFailure) } catch { continue }
    const candidate = extractCandidate(raw)
    if (!candidate) continue
    // Keep the most-complete sample as the unverified fallback (longest content wins).
    if (!best || raw.length > best.content.length) best = { candidate, content: raw }

    let v: VerifyResult
    try { v = await params.verify(candidate, params.question) } catch { v = { pass: false, mode: 'model', reason: 'verification errored' } }
    if (v.pass) {
      return { candidate, content: raw, verified: true, verifyMode: v.mode, attempts }
    }
    // Verify-guided retry: fold the failure reason into the next generation.
    priorFailure = (v.reason ?? '').slice(0, 400) || undefined
  }

  if (!best) return null
  return { candidate: best.candidate, content: best.content, verified: false, verifyMode: null, attempts }
}
