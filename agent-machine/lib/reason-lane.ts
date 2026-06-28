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
export function reasonSCK(env: NodeJS.ProcessEnv = process.env): number {
  const k = Math.floor(Number(env['NOETICA_SC_K'] ?? DEFAULT_SC_K))
  return Number.isFinite(k) && k >= 1 ? k : DEFAULT_SC_K
}

/** Is the reason lane enabled? Default ON (proven 0-regression winner); NOETICA_REASON_LANE=0 disables. */
export function reasonLaneEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
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
 * The CoT rule appended to the user's problem. Mirrors the bench REASON_RULE: explicit step-by-step
 * chains (what self-consistency votes over) ending in a single, parseable final-answer line — so a
 * non-reasoning model (e.g. qwen2.5:7b) actually engages CoT and we can vote over a normalized answer.
 */
export const REASON_RULE =
  '\n\nWork through this step by step, showing your reasoning. Then output your final result on its own last line in the exact form: "FINAL: <answer>".'

/**
 * Extract the votable answer key from a free-form CoT sample: the text after the last "FINAL:" marker,
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

export interface ReasonLaneResult {
  /** The full text of the representative winning sample (what gets streamed to the user). */
  content: string
  /** The normalized winning final-answer key (the voted choice). */
  choice: string
  /** Self-consistency agreement fraction in [0,1] — the winning vote mass. */
  agree: number
  /** Samples actually drawn (after Adaptive-SC early-stop). */
  n: number
}

/**
 * Run the no-retrieval CoT + self-consistency reason lane. Draws up to K CoT samples via `sample(idx)`
 * (each a full generation of the problem + REASON_RULE, at sampling temperature, NO retrieved context),
 * votes over the extracted FINAL answers with cragVote (the proven kernel), and returns the full text of
 * a sample that produced the winning answer. Throws nothing of its own; sampler errors surface to the
 * caller, which falls back to the existing path.
 *
 * @param sample produces the i-th CoT completion (caller supplies the model closure + temperature).
 * @param k self-consistency sample budget (use reasonSCK()).
 */
export async function runReasonLane(
  sample: (sampleIdx: number) => Promise<string>,
  k: number = DEFAULT_SC_K,
): Promise<ReasonLaneResult> {
  // Cache each drawn sample's full text so we can return the winner's prose, not just its key.
  const drawn: string[] = []
  const cachingSample = async (idx: number): Promise<string> => {
    const raw = await sample(idx)
    drawn[idx] = raw
    return raw
  }
  const vote = await cragVote(cachingSample, extractFinal, k, {
    // Single temp-0 fallback if no sample yielded a parseable FINAL line (matches the bench's askVote).
    fallback: () => cachingSample(drawn.length),
  })
  // Pick the full text of a sample whose extracted answer is the winning choice (first such draw);
  // fall back to the first non-empty sample so we never stream nothing.
  const winnerText =
    drawn.find((d) => d != null && extractFinal(d) === vote.choice) ??
    drawn.find((d) => d != null && d.trim() !== '') ??
    ''
  return { content: winnerText, choice: vote.choice, agree: vote.agree, n: vote.n }
}
