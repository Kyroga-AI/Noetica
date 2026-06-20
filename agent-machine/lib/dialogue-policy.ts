/**
 * dialogue-policy — the "what to do before answering" layer (Rasa's forms + the
 * fallback/clarification policy). Given the classified intent and the turn text,
 * it decides whether to PROCEED to generation or to CLARIFY first:
 *
 *  • Forms: a form-gated intent whose critical slot can't be filled from the turn
 *    (e.g. a bare "build it" with no target) → ask for the missing slot instead of
 *    guessing. This is what makes multi-part asks resolve correctly.
 *  • Fallback: very low NLU confidence with nothing to anchor on → ask a short
 *    clarifying question rather than silently defaulting.
 *
 * Pure functions, no model call — runs inline on the hot path.
 */
import type { IntentPlan } from './intent-router.js'

export interface SlotState { name: string; filled: boolean }
export interface PolicyDecision {
  slots: SlotState[]
  filled: string[]
  missing: string[]
  fillRate: number
  action: 'proceed' | 'clarify'
  prompt?: string   // the clarifying question (when action === 'clarify')
  reason?: string
}

// Intents where a missing CRITICAL slot should trigger a form (ask, don't guess).
// The critical slot is the intent's first slot; the question is what we ask for it.
const FORM_GATED: Record<string, { slot: string; question: string }> = {
  build_implement: { slot: 'target', question: 'What would you like me to build? Name the component, feature, or file.' },
  write_draft: { slot: 'type', question: 'What should I write — and who is the audience?' },
  research_lookup: { slot: 'question', question: 'What specifically should I research?' },
  compute_math: { slot: 'expression', question: 'What expression should I compute?' },
  fix_debug: { slot: 'symptom', question: "What's going wrong exactly — the error message or the symptom?" },
}

// Strip trigger cues + filler so we can tell whether the turn carries a real slot
// value ("build the auth form") vs. just the cue ("build it").
const CUE_STRIP = /\b(build|create|implement|add|set ?up|develop|scaffold|write|draft|compose|rewrite|research|find ?out|look ?up|search|compute|calculate|evaluate|solve|fix|debug|repair|please|can|could|would|you|i|we|want|like|need|to|the|a|an|this|that|it|me|my|for|now|some|help|with)\b/gi

function substantiveRemainder(text: string): string {
  return text.replace(CUE_STRIP, ' ').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function isSlotFilled(name: string, text: string, ctx: { hasDoc: boolean; entities: string[] }): boolean {
  if (name === 'doc') return ctx.hasDoc
  // Content slots are filled when the turn carries substance or a recognized entity.
  const CONTENT = ['target', 'question', 'topic', 'expression', 'claim', 'items', 'type', 'symptom', 'requirements', 'diff', 'preference', 'aspect', 'component', 'path']
  if (CONTENT.includes(name)) {
    return substantiveRemainder(text).split(' ').filter(Boolean).length >= 1 || ctx.entities.length > 0
  }
  // Optional/contextual slots (focus, depth, audience, criteria, …) never block.
  return true
}

export function decidePolicy(plan: IntentPlan, text: string, ctx: { hasDoc: boolean; entities: string[] }): PolicyDecision {
  const slots: SlotState[] = plan.slots.map((name) => ({ name, filled: isSlotFilled(name, text, ctx) }))
  const filled = slots.filter((s) => s.filled).map((s) => s.name)
  const missing = slots.filter((s) => !s.filled).map((s) => s.name)
  const fillRate = slots.length ? Number((filled.length / slots.length).toFixed(2)) : 1

  // (a) Form: a form-gated intent missing its critical slot → ask for it.
  const gate = FORM_GATED[plan.name]
  if (gate) {
    const remainder = substantiveRemainder(text)
    const hasContent = remainder.split(' ').filter(Boolean).length >= 2
      || ctx.entities.length > 0
      || (gate.slot === 'doc' && ctx.hasDoc)
    if (!hasContent) {
      return { slots, filled, missing, fillRate, action: 'clarify', prompt: gate.question, reason: `missing required slot: ${gate.slot}` }
    }
  }

  // (b) Fallback: no cue matched (score 0) and nothing to anchor on → clarify.
  if (plan.score === 0 && !ctx.hasDoc && text.trim().split(/\s+/).length >= 3) {
    return {
      slots, filled, missing, fillRate, action: 'clarify',
      prompt: 'I want to point this at the right capability — are you asking me to build something, look something up, or work with a document?',
      reason: 'low intent confidence',
    }
  }

  return { slots, filled, missing, fillRate, action: 'proceed' }
}

// ── Escalation policy ────────────────────────────────────────────────────────
// Fall back to a MORE CAPABLE model when the cheap/local flow is failing: after 2
// unresolved turns in a session, or after just 1 turn when intent/path confidence is
// low. Prefers a fast+capable cloud model when a key is present; otherwise the most
// capable local model available. Complements the success-rate capability hook.
export interface EscalationDecision {
  escalate: boolean
  provider?: 'anthropic' | 'openai' | 'ollama'
  model?: string
  reason?: string
}

// Local capability ladder (best first) for the no-cloud-key case.
const LOCAL_LADDER = ['qwen2.5:14b', 'deepseek-r1:8b', 'qwen2.5:7b']

export function decideEscalation(opts: {
  intentScore: number
  consecutiveUnresolved: number
  hasAnthropic: boolean
  hasOpenAI: boolean
  availableModels: string[]
  currentModel: string
}): EscalationDecision {
  const lowConfidence = opts.intentScore > 0 && opts.intentScore < 1.6 // weak/single-cue match
  const struggling = opts.consecutiveUnresolved >= 2
  const cloud: EscalationDecision | null = opts.hasAnthropic
    ? { escalate: true, provider: 'anthropic', model: 'claude-sonnet-4-6' }
    : opts.hasOpenAI ? { escalate: true, provider: 'openai', model: 'gpt-4o' } : null

  // 1-turn low-confidence escalation goes ONLY to a fast cloud model. Escalating a
  // shaky turn to the slow local reasoner would just reintroduce the latency stall —
  // better to stay on the routed model than grind. (No cloud key → no 1-turn bump.)
  if (lowConfidence && cloud) return { ...cloud, reason: 'low intent/path confidence (1-turn)' }

  // Genuine multi-turn struggle: use the big gun — cloud if available, else climb the
  // local capability ladder (accepting the slower model because we're truly stuck).
  if (struggling) {
    const reason = `unresolved ${opts.consecutiveUnresolved} turns`
    if (cloud) return { ...cloud, reason }
    // Only climb to a STRICTLY more capable local model (higher on the ladder than
    // the current one) — never sidestep/downgrade. If we're already at the top
    // available local model, there's nothing more capable: stay put.
    const rank = (m: string) => { const i = LOCAL_LADDER.indexOf(m); return i === -1 ? LOCAL_LADDER.length : i }
    const curRank = rank(opts.currentModel)
    const better = LOCAL_LADDER.find((m, i) => i < curRank && opts.availableModels.includes(m))
    if (better) return { escalate: true, provider: 'ollama', model: better, reason }
  }
  return { escalate: false } // confident enough, or nothing more capable available
}
