/**
 * crag-gate — the CRAG adaptive-retrieval gate + its sampling-loop self-consistency voter, extracted from the
 * MMLU bench so the EXACT decision logic the board proved is a tested, reusable PRODUCTION module (not
 * bench-trapped).
 *
 * What the board measured (qwen2.5:7b, n=30/subject): the `gate` arm beat both baseline AND the always-retrieve
 * `brain` arm — 63.3% vs 55%/55% overall, +10pp on abstract_algebra where the brain arm actually REGRESSED.
 * The lesson: the lever is SELECTIVE retrieval, not more retrieval. Injecting wrong-field context into a
 * question the model already knows degrades it; a confident closed-book answer should skip retrieval entirely.
 *
 * Everything here is pure (no model/network coupling — the caller supplies a `sample` closure), so it
 * unit-tests deterministically. Complements lib/self-consistency.ts: that module's majorityVote post-processes
 * a FIXED set of answers; cragVote DRIVES the sampling loop and early-stops, which is what saves model calls.
 */

export interface VoteResult {
  /** The winning extracted key, or '' when nothing could be extracted from any sample. */
  choice: string
  /** Winning fraction of the (weighted) vote mass in [0,1] — the calibrated confidence signal the gate reads. */
  agree: number
  /** How many samples were actually drawn (after Adaptive-SC early-stop; includes a fallback draw if used). */
  n: number
}

export interface VoteOptions {
  /** CISC (confidence-weighted self-consistency): weight each vote by the model's stated confidence in [0,1].
   *  Default: every vote counts 1. */
  weight?: (raw: string) => number
  /** Adaptive-SC (Snell, NeurIPS'24) lossless early-stop: stop once the leader can't be caught by the samples
   *  that remain. Default on. */
  earlyStop?: boolean
  /** Drawn ONCE if no sample yielded an extractable key — lets the caller retry at temp 0 / a plainer prompt
   *  rather than abstain. Its extraction is returned with agree=0 (no confidence). */
  fallback?: () => Promise<string>
}

/**
 * Self-consistency over a sampling loop: draw up to `k` samples via `sample(idx)`, extract a key from each via
 * `extract`, and return the weighted-majority key with its agreement fraction. `k <= 1` collapses to a single
 * draw (voting off). Faithful port of the bench's askVote — same Adaptive-SC early-stop and agreement metric.
 * The agreement fraction IS the gate's confidence signal: feed it to gateShouldRetrieve().
 */
export async function cragVote(
  sample: (sampleIdx: number) => Promise<string>,
  extract: (raw: string) => string | null,
  k: number,
  opts: VoteOptions = {},
): Promise<VoteResult> {
  const weight = opts.weight ?? (() => 1)
  const earlyStop = opts.earlyStop ?? true
  if (k <= 1) {
    const only = extract(await sample(0))
    return { choice: only ?? '', agree: only ? 1 : 0, n: 1 }
  }
  const votes = new Map<string, number>()
  let total = 0
  let drawn = 0
  for (let s = 0; s < k; s++) {
    drawn++
    const raw = await sample(s)
    const l = extract(raw)
    if (!l) continue
    const w = weight(raw)
    votes.set(l, (votes.get(l) || 0) + w); total += w
    if (earlyStop && s >= 2) {                                // LOSSLESS early-stop: leader uncatchable by the rest
      const v = [...votes.values()].sort((a, b) => b - a)
      if ((v[0]! - (v[1] ?? 0)) > (k - 1 - s)) break
    }
  }
  if (!votes.size) {
    if (opts.fallback) { const f = extract(await opts.fallback()); return { choice: f ?? '', agree: 0, n: drawn + 1 } }
    return { choice: '', agree: 0, n: drawn }
  }
  const [choice, n] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]!
  return { choice, agree: total ? n / total : 0, n: drawn }   // agree = winning fraction of the (weighted) mass
}

/** CRAG gate threshold: closed-book self-consistency agreement at/above this means the model is confident
 *  enough to SKIP retrieval. The board's 0.8 default; tunable per deployment. */
export const DEFAULT_GATE_THRESHOLD = 0.8

/**
 * The gate's first decision: should we retrieve at all? A confident closed-book answer (agreement ≥ threshold)
 * skips retrieval — injecting context into a question the model already knows only adds wrong-field noise
 * (the exact failure that regressed the always-retrieve brain arm on abstract_algebra). Uncertain → retrieve.
 */
export function gateShouldRetrieve(closedBookAgree: number, threshold = DEFAULT_GATE_THRESHOLD): boolean {
  return closedBookAgree < threshold
}

/**
 * CRAG correction: once we DID retrieve, accept the retrieval-grounded answer only if it is at least as
 * self-consistent as the closed-book answer. Weak/ambiguous retrieved context lowers agreement — in that case
 * keep the closed-book reasoning instead of letting noisy chunks pull the answer around.
 */
export function acceptRetrievedAnswer(retrieveAgree: number, closedBookAgree: number): boolean {
  return retrieveAgree >= closedBookAgree
}

/** Cheap grounding-gate: skip retrieval once at least this many canon entities are present in the question. */
export const DEFAULT_GROUNDING_MIN_ENTITIES = 2

/**
 * CHEAP gate variant: decide retrieve-vs-skip from canon entity COUNT alone — NO K-sample confidence probe, so
 * it costs zero extra model calls (canonRoute already extracts the entities). The hypothesis being measured: a
 * question built from ≥2 canon concepts is standard textbook material the model likely knows closed-book, so
 * chunk retrieval only adds noise → skip; a question that grounds in 0–1 canon concepts reaches beyond what we
 * cover → retrieve. (canonRoute's tri-state grounding_status is too coarse here — full exam questions almost
 * never reach 'grounded', since candidateNPs flags some out-of-canon noun phrase in nearly every question — so
 * the absolute entity count is the discriminative signal.) Whether this free proxy matches the expensive
 * SC-confidence gate is exactly what the `groundgate` bench arm exists to test.
 */
export function groundingGateShouldRetrieve(entityCount: number, minToSkip = DEFAULT_GROUNDING_MIN_ENTITIES): boolean {
  return entityCount < minToSkip
}
