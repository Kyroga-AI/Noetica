/**
 * reason-lane — the no-retrieval CoT + self-consistency serving lane for math/reasoning intents.
 *
 * What the board measured (qwen2.5:7b, college_math, n=30, seed 1729): the `reason` arm — explicit
 * step-by-step chain-of-thought + self-consistency over K samples, with NO retrieval — beat BOTH the
 * baseline AND the always-retrieve RAG/brain arm by +24pp, with 0 regressions. The lesson: for KNOWN
 * math/reasoning, retrieval is the wrong tool — injecting lecture fragments into a question the model
 * can reason about closed-book only adds noise. SOTA uses long-CoT + self-consistency, never RAG.
 *
 * This module promotes that exact bench condition into serving: for math/reasoning intents we SKIP
 * retrieval and answer via cragVote (the SAME voting kernel the bench proved, lib/crag-gate.ts) over
 * CoT samples. It is intent-gated and strictly additive — it does NOT touch the CRAG confidence-gate
 * (gateShouldRetrieve), which did NOT replicate. The gate here is intent membership, not a probe.
 *
 * Free-form (production) vs MCQ (bench): the bench voted over a final A/B/C/D letter; production
 * answers are free-form, so we vote over the normalized final-answer string the CoT emits and return
 * the full winning sample's text. The kernel (cragVote: weighted majority + Adaptive-SC early-stop)
 * is identical.
 */

import { cragVote } from './crag-gate.js'

/** Default K for self-consistency — the proven config (env NOETICA_SC_K overrides). */
export const DEFAULT_SC_K = 3

/** Resolve the self-consistency sample count from env, defaulting to the proven K=3. */
export function reasonSCK(env: Record<string, string | undefined> = process.env): number {
  const k = Math.floor(Number(env['NOETICA_SC_K'] ?? DEFAULT_SC_K))
  return Number.isFinite(k) && k >= 1 ? k : DEFAULT_SC_K
}

/** Is the reason lane enabled? Default ON (proven 0-regression winner); NOETICA_REASON_LANE=0 disables. */
export function reasonLaneEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env['NOETICA_REASON_LANE'] !== '0'
}

/**
 * The math/reasoning intents routed to the no-retrieval CoT+SC lane. Scoped to the problem-SOLVING
 * intents that mirror the +24pp college_math condition: compute_math (calculate/solve/integral/…) and
 * prove_reason (prove/derive/show that/…). These are exactly the turns where parametric step-by-step
 * reasoning beats retrieved fragments. Explanation/planning/review intents (explain_teach,
 * plan_nextsteps, review_audit, compare_benchmark) keep their existing retrieval + critic path —
 * they benefit from grounding and were NOT part of the proven experiment.
 */
export const REASON_LANE_INTENTS = new Set<string>(['compute_math', 'prove_reason'])

/** Does this intent route to the no-retrieval CoT+SC reason lane? */
export function isReasonLaneIntent(intentName: string): boolean {
  return REASON_LANE_INTENTS.has(intentName)
}

/**
 * FREE-FORM CoT rule (the SERVING default). Production /api/chat math/reasoning turns are open-ended —
 * there are NO A/B/C/D options — so the model must emit its free-form final answer on a marked line we
 * can vote over as a STRING. Ends in a single, parseable "FINAL:" line so a non-reasoning model
 * (e.g. qwen2.5:7b) actually engages CoT and we can normalize+vote the answer.
 */
export const REASON_RULE =
  '\n\nWork through this step by step, showing your reasoning. Then output your final answer on its own last line, starting with "FINAL:".'

/**
 * MCQ CoT rule — kept for any caller that DOES present discrete A/B/C/D options (mirrors the bench
 * REASON_RULE). The serving lane never uses this by default; it exists so an MCQ caller still gets a
 * letter-shaped final line that letterExtractor can vote over.
 */
export const REASON_RULE_MCQ =
  '\n\nWork through this step by step, showing your reasoning, then output exactly one final line: "FINAL: X" (X = A, B, C, or D).'

/**
 * Extract the votable answer key from a FREE-FORM CoT sample: the text after the last "FINAL:" marker,
 * normalized (lowercased, whitespace-collapsed, trailing punctuation trimmed) so trivially-different
 * phrasings of the same answer vote together. Returns null when the sample is empty / has no final line
 * (so cragVote skips it rather than counting a junk vote).
 */
export function extractFinal(raw: string): string | null {
  if (!raw || !raw.trim()) return null
  const matches = [...raw.matchAll(/FINAL:\s*(.+?)\s*$/gim)]
  const last = matches.length ? matches[matches.length - 1]![1] : null
  const ans = (last ?? '').trim()
  if (!ans) return null
  return ans.toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim() || null
}

/**
 * Extract the votable LETTER key from an MCQ CoT sample: the A–D after the last "FINAL:" marker
 * (tolerating **bold**, parens, spacing). Returns null when no letter is found, so the kernel skips a
 * junk vote. This is the MCQ-mode analog of extractFinal — it votes over letters, not strings.
 */
export function extractLetter(raw: string): string | null {
  if (!raw || !raw.trim()) return null
  const matches = [...raw.matchAll(/FINAL:\s*\**\(?\s*([A-D])\b/gi)]
  const last = matches.length ? matches[matches.length - 1]![1] : null
  return last ? last.toUpperCase() : null
}

/**
 * Does this turn present discrete enumerated MCQ options (e.g. lines like "A) ..." / "B. ...")? Used to
 * route an explicit-options turn to MCQ mode; everything else (the serving default) is free-form. We
 * require at least an A and a B option line so a stray "A)" in prose doesn't trip the detector.
 */
export function looksLikeMCQ(text: string): boolean {
  if (!text) return false
  const hasA = /(^|\n)\s*A[).:]\s+\S/.test(text)
  const hasB = /(^|\n)\s*B[).:]\s+\S/.test(text)
  return hasA && hasB
}

/** Reason-lane answer mode: free-form string voting (serving) vs MCQ letter voting (explicit options). */
export type ReasonLaneMode = 'free' | 'mcq'

export interface ReasonLaneResult {
  /** The full text of the representative winning sample (what gets streamed to the user). */
  content: string
  /** The voted choice — a normalized free-form answer string, or a letter in MCQ mode. */
  choice: string
  /** Self-consistency agreement fraction in [0,1] — the winning vote mass. */
  agree: number
  /** Count of samples that voted for the winning choice (the plurality size). */
  agreeCount: number
  /** Did self-consistency actually agree (a genuine plurality of ≥2 votes)? false when we fell back to a
   *  single sample because no answer repeated — so the caller/evidence knows the SC vote was degenerate. */
  consensus: boolean
  /** Samples actually drawn (after Adaptive-SC early-stop). */
  n: number
  /** The answer mode used for this turn. */
  mode: ReasonLaneMode
}

export interface ReasonLaneOptions {
  /** Answer mode. Default 'free' (the serving default). Pass 'mcq' for explicit-options turns. */
  mode?: ReasonLaneMode
}

/** Pick the most-complete cached sample (longest non-empty text) — the best single CoT to return when
 *  self-consistency produced no plurality and we must fall back to one sample rather than garbage. */
function mostCompleteSample(drawn: string[]): string {
  let best = ''
  for (const d of drawn) {
    if (d != null && d.trim() !== '' && d.length > best.length) best = d
  }
  return best
}

/**
 * Run the no-retrieval CoT + self-consistency reason lane. Draws up to K CoT samples via `sample(idx)`
 * (each a full generation of the problem + REASON_RULE, at sampling temperature, NO retrieved context),
 * votes over the extracted answers with cragVote (the proven kernel), and returns the full text of a
 * sample that produced the winning answer.
 *
 * Mode: 'free' (serving default) votes over normalized free-form FINAL strings; 'mcq' votes over the
 * A–D letter (for callers presenting discrete options). The kernel is identical — only the extractor
 * differs.
 *
 * Degenerate-vote safety (the free-form failure this fixes): verbose free-form answers often all differ,
 * so a "majority" of 1 is meaningless. When no answer repeats (no real plurality), we DON'T return a
 * coin-flip winner — we set consensus=false and return the most-complete single CoT (longest sample), so
 * the user still gets a coherent answer and the evidence records that SC did not agree. A genuine
 * plurality (≥2 votes) sets consensus=true. K=1 is a single CoT with no vote (consensus=false).
 *
 * Throws nothing of its own; sampler errors surface to the caller, which falls back to the existing path.
 *
 * @param sample produces the i-th CoT completion (caller supplies the model closure + temperature).
 * @param k self-consistency sample budget (use reasonSCK()).
 * @param opts.mode 'free' (default) | 'mcq'.
 */
export async function runReasonLane(
  sample: (sampleIdx: number) => Promise<string>,
  k: number = DEFAULT_SC_K,
  opts: ReasonLaneOptions = {},
): Promise<ReasonLaneResult> {
  const mode: ReasonLaneMode = opts.mode ?? 'free'
  const extract = mode === 'mcq' ? extractLetter : extractFinal
  // Cache each drawn sample's full text so we can return the winner's prose, not just its key.
  const drawn: string[] = []
  const cachingSample = async (idx: number): Promise<string> => {
    const raw = await sample(idx)
    drawn[idx] = raw
    return raw
  }
  const vote = await cragVote(cachingSample, extract, k, {
    // Single temp-0 fallback if no sample yielded a parseable FINAL line (matches the bench's askVote).
    fallback: () => cachingSample(drawn.length),
  })

  // Count how many drawn samples actually voted for the winning choice (the plurality size). cragVote's
  // `agree` is a fraction; we need the absolute count to tell a real plurality (≥2) from a 1-vote tie.
  const agreeCount = vote.choice
    ? drawn.filter((d) => d != null && extract(d) === vote.choice).length
    : 0
  // Consensus = a genuine plurality of ≥2 samples agreeing. K=1 (single draw, no vote) is NOT consensus.
  const consensus = k > 1 && agreeCount >= 2

  let content: string
  if (consensus) {
    // A real plurality: return the full text of a sample whose answer is the winning choice.
    content = drawn.find((d) => d != null && extract(d) === vote.choice) ?? mostCompleteSample(drawn)
  } else if (k <= 1) {
    // Single CoT, no vote: return that draw (or the most-complete cached, e.g. after fallback).
    content = drawn.find((d) => d != null && extract(d) === vote.choice) ?? mostCompleteSample(drawn)
  } else {
    // No plurality (all distinct — common for verbose free-form): DON'T return a coin-flip winner.
    // Fall back to the single most-complete CoT so we never stream garbage/empty.
    content = mostCompleteSample(drawn)
  }

  return { content, choice: vote.choice, agree: vote.agree, agreeCount, consensus, n: vote.n, mode }
}
