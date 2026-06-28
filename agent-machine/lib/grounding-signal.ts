/**
 * grounding-signal — consume canonRoute's `grounding_status` in the SERVING path (peer-audit Priority 7).
 *
 * The audit found `grounding_status` was computed by canonRoute but NEVER consumed by server.ts — the
 * last unforced competitive gap (an OntoGPT-class silent failure: ungrounded entities slip through as
 * AUTO: IDs with no visibility). This module binds that signal to behaviour, additively and safely:
 *
 *   1. PROVENANCE/TELEMETRY (primary value): surface `grounding_status` in the /api/chat response
 *      metadata and in the per-turn `noetica.turn` ReasoningEvent `extra` — making "how grounded was
 *      this answer" auditable for the first time. It is just an enum, so it is safe-trace (no content).
 *   2. ENSURE-RETRIEVE on `ungrounded`: an ungrounded turn MUST run retrieval — bind the signal to the
 *      behaviour so retrieval-on is intentional, not incidental. (Today serving already retrieves when
 *      documentChunkCount()>0 && retrieval!=='none'; this makes ungrounded an EXPLICIT retrieve trigger.)
 *   3. UNCERTAINTY MARKER on `partial`: attach a lightweight `grounding: 'partial'` flag to the response
 *      metadata so downstream/UI can signal lower confidence. The answer TEXT is never altered.
 *
 * Discipline (from the audit's own dead-ends):
 *   • Do NOT use `grounded` to suppress/skip retrieval. A prior probe found candidateNPs flags an
 *     out-of-canon noun phrase on ~every real query, so `grounded` ~never fires on full questions and a
 *     "skip when grounded" gate degenerates to always-retrieve. So `grounded` here is TELEMETRY ONLY.
 *   • Retrieval-eligible intents ONLY. The reason-lane intents (compute_math / prove_reason) deliberately
 *     skip retrieval (the proven +24pp condition) — this module must NEVER cause retrieval for them.
 *   • Exception-safe: a canonRoute hiccup defaults to 'ungrounded' (ensure-retrieve) so a turn never breaks.
 *
 * Behind env flag NOETICA_GROUNDING_SIGNAL (default ON; `=0` reverts to current behaviour).
 */
import { canonRoute, type GroundingStatus } from './canon-route.js'

export type { GroundingStatus }

/** Is the grounding signal enabled? Default ON; NOETICA_GROUNDING_SIGNAL=0 disables (revert to prior behaviour). */
export function groundingSignalEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env['NOETICA_GROUNDING_SIGNAL'] !== '0'
}

export interface GroundingDecision {
  /** Whether the grounding signal was actually computed (eligible intent + flag on). */
  active: boolean
  /** The canon grounding status for this turn ('ungrounded' on fallback). Undefined when not active. */
  status?: GroundingStatus
  /** ungrounded ⇒ retrieval MUST run (explicit ensure-retrieve binding). False when not active. */
  ensureRetrieve: boolean
  /** partial ⇒ attach an uncertainty/provenance marker to the response metadata. False when not active. */
  partial: boolean
}

/**
 * Compute the per-turn grounding decision for a retrieval-eligible turn.
 *
 * @param question         the user query already in scope on the turn.
 * @param retrievalEligible FALSE for reason-lane intents (compute_math/prove_reason) — the signal then
 *                          stays inert (active=false, ensureRetrieve=false) so it can NEVER cause retrieval
 *                          for the no-retrieval reason lane.
 * @param opts.route       injectable canonRoute (for tests); defaults to the real canonRoute.
 * @param opts.env         injectable env (for tests); defaults to process.env.
 *
 * Exception-safe: if `route` throws, the turn is treated as 'ungrounded' (ensure-retrieve) and never breaks.
 */
export function decideGrounding(
  question: string,
  retrievalEligible: boolean,
  opts: { route?: (q: string) => { grounding_status: GroundingStatus }; env?: Record<string, string | undefined> } = {},
): GroundingDecision {
  const env = opts.env ?? process.env
  // Inert for reason-lane intents and when the flag is off — guarantees we never alter the reason lane
  // or any current behaviour when disabled.
  if (!retrievalEligible || !groundingSignalEnabled(env)) {
    return { active: false, ensureRetrieve: false, partial: false }
  }
  const route = opts.route ?? canonRoute
  let status: GroundingStatus
  try {
    status = route(question).grounding_status
  } catch {
    // canonRoute hiccup → treat as ungrounded so retrieval is still guaranteed to run.
    status = 'ungrounded'
  }
  return {
    active: true,
    status,
    ensureRetrieve: status === 'ungrounded',
    partial: status === 'partial',
  }
}
