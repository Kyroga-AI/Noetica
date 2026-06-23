/**
 * council — the SHARED ensemble combiner (extracted from the MMLU bench so the product and the
 * benchmark run the SAME council, not two parallel stacks). This is the keystone of the unified
 * reasoning core: the audit found the bench's winning council (Council V2: champion 63.6% > brain
 * 60.7%) had ZERO product equivalent — the benchmark validated code the live server never ran.
 *
 * Council V2 is grounding-weighted + entanglement-aware: the LLM arms (baseline, self-consistency,
 * manipulation) are CORRELATED — they make the same errors — so a flat vote lets that bloc swamp the
 * INDEPENDENT retrieval arms even when retrieval is right (the dilution). So each retrieval arm's vote
 * is weighted BY its grounding strength (top cosine), the correlated closed-book bloc is down-weighted,
 * and two independent retrieval arms agreeing earns a confidence-scaled consensus bonus. Subject- and
 * domain-agnostic — the conditional is per-question. (Beyond Majority Voting 2510.01499; entanglement
 * reweighting 2604.07650.)
 */

export interface CouncilInput {
  baseline?: string   // closed-book reasoning answer (a letter A-D, or undefined/'?')
  brain?: string      // retrieval answer
  qgen?: string       // HyDE/step-back retrieval answer (the 2nd independent retrieval arm)
  gate?: string       // CRAG adaptive-retrieval answer — the board's TOP arm (measured winner, 62.9%)
  medprompt?: string  // position-bias-corrected ensemble vote (de-biased, 62.1%)
  brainConf?: number  // brain retrieval grounding strength [0,1] (top cosine)
  qgenConf?: number   // qgen retrieval grounding strength [0,1]
  manip?: string      // manipulation-layer voter (Self-Discover plan→execute)
  scLetter: string    // self-consistency reasoning vote (majority letter)
  scAgree: number     // self-consistency agreement [0,1]
}

export interface CouncilResult { letter: string; weights: Record<string, number> }

const clamp01 = (x: number): number => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0))

/**
 * Combine the arm votes into one answer. v2 (default) = grounding-weighted; v2:false = the flat V1
 * council. NEVER defaults to 'A' (the positional-bias trap the old verify path fell into).
 */
export function councilVote(inp: CouncilInput, opts: { v2?: boolean; manip?: boolean } = {}): CouncilResult {
  const v2 = opts.v2 ?? true
  const w = new Map<string, number>()
  const add = (L: string | undefined, wt: number): void => { if (typeof L === 'string' && L && L !== '?') w.set(L, (w.get(L) ?? 0) + wt) }

  if (v2) {
    const bc = clamp01(inp.brainConf ?? 0), qc = clamp01(inp.qgenConf ?? 0)
    add(inp.baseline, 0.6)              // closed-book — weakest on STEM
    add(inp.brain, 0.6 + 1.8 * bc)      // retrieval, weighted by grounding (conf 0.8 → 2.04)
    add(inp.qgen, 0.6 + 1.8 * qc)       // HyDE retrieval, same conditional
    // The board's TOP arms, promoted into the council (the old council omitted them and stalled at the
    // brain's score). gate = CRAG adaptive (already confidence-gated → trust it); medprompt = de-biased
    // ensemble. They're not perfectly independent of brain/qgen, so weight strong-but-not-dominant.
    add(inp.gate, 1.6)
    add(inp.medprompt, 1.2)
    if (inp.brain && inp.brain !== '?' && inp.brain === inp.qgen) {
      add(inp.brain, 1.0 + 1.5 * Math.max(bc, qc)) // grounded consensus, confidence-scaled
    }
    // gate agreeing with the grounded retrieval is the strongest signal we have — reward the concordance.
    if (inp.gate && inp.gate !== '?' && (inp.gate === inp.brain || inp.gate === inp.qgen)) add(inp.gate, 0.8)
  } else {
    add(inp.baseline, 1); add(inp.brain, 1); add(inp.qgen, 1)
  }
  // clamp scAgree like the conf inputs: an out-of-band (>1) value would let the closed-book reasoning
  // vote re-dominate the very correlated bloc V2 exists to suppress, and a NaN (e.g. Number(undefined)
  // upstream) would poison the tally AND make the sort comparator non-deterministic (NaN compares false).
  const sa = clamp01(inp.scAgree)
  // manip (Self-Discover) was the WEAKEST board arm (46.4%) — a correlated closed-book voter that dragged
  // the council. Demote it to a whisper in V2: it can break a tie, never swamp the grounded arms.
  if (opts.manip !== false) add(inp.manip, v2 ? 0.3 : 1.2)
  add(inp.scLetter, v2 ? 0.5 + 0.5 * sa : 1 + sa)            // V2 halves the closed-book reasoning vote

  // Tie-break toward the self-consistency letter; otherwise a STABLE alphabetical order. (The old final
  // clause pushed 'A' to the bottom — an anti-'A' bias, the inverse of the positional trap it claimed to
  // fix. Bias neither way: equal evidence → deterministic, letter-neutral.)
  const ranked = [...w.entries()].sort((a, b) =>
    b[1] - a[1] ||
    (a[0] === inp.scLetter ? -1 : b[0] === inp.scLetter ? 1 : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return { letter: ranked[0]?.[0] || inp.scLetter || 'B', weights: Object.fromEntries(w) }
}
