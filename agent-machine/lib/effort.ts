/**
 * effort — match the work to the request.
 *
 * The system has heavy lanes (multi-candidate critic deliberation, sub-agents, model escalation,
 * code-building) and a trivial question can fall into them ("how to make coffee" → "build an app").
 * assessEffort estimates how much machinery a turn actually warrants, so the expensive paths only fire
 * when the request is genuinely complex. It only ever DOWNGRADES (caps) — it never spends more than the
 * configured ceiling — so it can't break complex work, only stop over-engineering the simple stuff.
 */
export type EffortTier = 'light' | 'standard' | 'heavy'

export interface EffortAssessment {
  tier: EffortTier
  maxBestOfN: number   // cap on the critic's best-of-N deliberation (light ⇒ 1 ⇒ no deliberation at all)
  reason: string
}

// Inherently quick intents — a single direct answer, never multi-candidate deliberation.
const LIGHT_INTENTS = new Set(['converse_smalltalk', 'confirm_steer', 'everyday', 'status_check', 'self_identity', 'meta_capability'])
// Intents that genuinely justify heavy machinery (building, debugging, proving, planning, auditing).
const HEAVY_INTENTS = new Set(['build_implement', 'fix_debug', 'configure_ops', 'code_review', 'prove_reason', 'compute_math', 'plan_nextsteps', 'review_audit'])
// Explicit "do a lot" signals — never downgrade a turn that asks for thoroughness / scale / multi-step.
const HEAVY_CUES = /\b(comprehensive|thorough(ly)?|in depth|in-depth|deep ?dive|production[- ]?(ready|grade)|end[- ]?to[- ]?end|exhaustive|robust|enterprise|scalable|step[- ]?by[- ]?step|multi[- ]?step|architect|design (a|an|the) (system|pipeline|architecture)|and then|first.+then)\b/i

/**
 * Assess how much effort a turn warrants. `standardCeiling` is the configured default best-of-N (so a
 * standard/heavy turn is unchanged from today); only LIGHT turns are capped down to a single sample.
 */
export function assessEffort(query: string, intentName: string, standardCeiling = 3): EffortAssessment {
  const q = query.trim()
  const words = q.split(/\s+/).filter(Boolean).length
  const compound = /\b(and|then|also|plus|as well as)\b/i.test(q)
    || (q.match(/[.!?]/g)?.length ?? 0) >= 2
    || /[\n;]/.test(q)
    || /(^|\s)[-*]\s/.test(q)
  const heavyCue = HEAVY_CUES.test(q)

  // Heavy first: an explicit scale/thoroughness signal or a build/debug/prove intent is never downgraded.
  if (heavyCue || HEAVY_INTENTS.has(intentName)) {
    return { tier: 'heavy', maxBestOfN: Math.max(standardCeiling, 1), reason: heavyCue ? 'explicit thoroughness/scale signal' : `heavy intent (${intentName})` }
  }
  // Light: a quick intent, OR a short single-clause request with no compound requirements.
  if (LIGHT_INTENTS.has(intentName)) {
    return { tier: 'light', maxBestOfN: 1, reason: `light intent (${intentName})` }
  }
  if (words <= 14 && !compound) {
    return { tier: 'light', maxBestOfN: 1, reason: 'short single-clause request' }
  }
  return { tier: 'standard', maxBestOfN: Math.max(standardCeiling, 1), reason: 'standard request' }
}
