/**
 * best-of-n.ts — verifier-reranked best-of-N selection (the test-time-compute keystone).
 *
 * Noetica already owns a deterministic grounding-VERIFIER, but only runs it ONCE per claim (a gate). The
 * 2024–2026 test-time-compute literature spends all its effort building a verifier good enough to SELECT
 * among samples — we already have the near-zero-false-positive version. So: sample N candidates, score each
 * with the verifier, return argmax. Zero training, any local model, inherits the field's largest gains.
 * Refs: Cobbe et al. 2021 (training verifiers / best-of-N); Snell et al. 2024 (compute-optimal scaling).
 *
 * This module is the SELECTION POLICY (pure, tested). Generation + verification are wired in by the caller.
 */

export interface VerifiedCandidate {
  text: string
  verified: boolean      // did the deterministic grounding check pass?
  coverage: number       // 0..1 fraction of claim tokens supported by sources
  score?: number         // optional secondary quality signal (e.g. judge / relevance)
}

/**
 * Rank candidates by the verifier-first policy:
 *   1. grounded (verified) candidates beat ungrounded ones — we trust verification over fluency,
 *   2. then higher grounding coverage,
 *   3. then the optional secondary score,
 *   4. then more complete (longer) as a final, weak tiebreak.
 * Returns the best candidate and the full ranking. Empty input → best:null.
 */
export function selectBestOfN(candidates: VerifiedCandidate[]): { best: VerifiedCandidate | null; ranking: VerifiedCandidate[]; agreement: number } {
  if (candidates.length === 0) return { best: null, ranking: [], agreement: 0 }
  const ranking = [...candidates].sort((a, b) =>
    (Number(b.verified) - Number(a.verified)) ||
    (b.coverage - a.coverage) ||
    ((b.score ?? 0) - (a.score ?? 0)) ||
    (b.text.length - a.text.length),
  )
  // agreement = share of candidates whose normalized text matches the winner (self-consistency signal)
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  const top = norm(ranking[0]!.text)
  const agreement = candidates.filter((c) => norm(c.text) === top).length / candidates.length
  return { best: ranking[0]!, ranking, agreement }
}

/** Generic argmax by a numeric key (the bare best-of-N primitive for non-verifier scores). */
export function argmaxBy<T>(items: T[], key: (t: T) => number): T | null {
  if (items.length === 0) return null
  let best: T = items[0]!, bestK = key(best)
  for (const it of items.slice(1)) { const k = key(it); if (k > bestK) { best = it; bestK = k } }
  return best
}

/**
 * Whether sampling MORE candidates is worth it: stop early when we already have a grounded winner with
 * strong agreement (self-consistency) or high coverage. Lets the loop spend compute only where it helps.
 */
export function shouldStop(current: { best: VerifiedCandidate | null; agreement: number }, opts: { minAgreement?: number; minCoverage?: number } = {}): boolean {
  const b = current.best
  if (!b || !b.verified) return false
  return current.agreement >= (opts.minAgreement ?? 0.6) || b.coverage >= (opts.minCoverage ?? 0.9)
}
