/**
 * Graph-RL — reward mining.
 *
 * Turns the signals Noetica already produces per turn into a single scalar reward∈[0,1] for the
 * graph-RL policy. These signals are REAL and already computed on the hot path (grounding-signal.ts,
 * noetica-events Assay severity, value-judgment worth, graph-proposals accept/reject) — the loop just
 * mines them. Explicit human signal (accept/reject) dominates when present; otherwise we blend the
 * automatic signals. This is the "learn from users" channel; the "learn for the community" channel
 * aggregates these same rewards over the commons in Phase 2.
 */

export interface RewardSignals {
  /** Grounding verdict from grounding-signal.ts. */
  grounding?: 'ok' | 'partial' | 'ungrounded'
  /** Assay tri-state verdict (noetica-events Severity). */
  assay?: 'ok' | 'sad' | 'bad'
  /** Value-judgment worth in [0,1] (shaped reward already computed per turn). */
  worth?: number
  /** Explicit human signal: a graph proposal from this turn was accepted / rejected. */
  accepted?: boolean
  rejected?: boolean
  /** Explicit 👍/👎. */
  thumbs?: 'up' | 'down'
}

const GROUNDING_R: Record<NonNullable<RewardSignals['grounding']>, number> = { ok: 1, partial: 0.5, ungrounded: 0 }
const ASSAY_R: Record<NonNullable<RewardSignals['assay']>, number> = { ok: 1, sad: 0.5, bad: 0 }

/**
 * Reward∈[0,1]. Explicit human verdicts (accept/reject, thumbs) are the strongest signal and, when
 * present, set the reward directly. Otherwise blend the available automatic signals (equal weight).
 * Returns null when there is no signal at all (caller skips the update rather than inventing a reward).
 */
export function grlReward(s: RewardSignals): number | null {
  // Strongest, most direct signal wins outright.
  if (s.rejected || s.thumbs === 'down') return 0
  if (s.accepted || s.thumbs === 'up') return 1

  const parts: number[] = []
  if (s.grounding) parts.push(GROUNDING_R[s.grounding])
  if (s.assay) parts.push(ASSAY_R[s.assay])
  if (typeof s.worth === 'number' && Number.isFinite(s.worth)) parts.push(Math.max(0, Math.min(1, s.worth)))
  if (parts.length === 0) return null
  return parts.reduce((a, b) => a + b, 0) / parts.length
}
