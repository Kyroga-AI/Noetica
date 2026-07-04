/**
 * learning-scheduler.ts — unified 3-loop learning scheduler.
 *
 * Routes each completed turn through all three learning loops as a single call so they compound
 * rather than running independently:
 *   1. eval-capture  — failures → replayable regression cases; successes → Langfuse sink
 *   2. procedural-memory — successes → distilled skills + verified experiences (strict gate)
 *   3. srs — newly distilled skills enroll an SRS card; getSkillsDue() surfaces due reviews
 *
 * The scheduler owns the routing logic; each loop library remains pure (no cross-imports).
 */
import { captureFailure, captureProcedural, type Trace, type EvalCase } from './eval-capture.js'
import { distillSkill, distillExperience, type Skill, type ReasoningExperience } from './procedural-memory.js'
import { newCard, review as srsReview, dueCards, type Card } from './srs.js'

export interface TurnContext {
  input: string
  output: string
  verified: boolean
  coverage: number
  task: string
  steps: string[]     // trajectory action types from the run
  worth: number       // VJ quality score 0–1
  traceId?: string
  model?: string
  latencyMs?: number
  now: number
}

export interface SkillWithCard extends Skill { card: Card }

export interface ScheduleResult {
  path: 'failure' | 'success' | 'skip'
  evalCase: EvalCase | null
  skill: SkillWithCard | null
  experience: ReasoningExperience | null
}

/**
 * Run all three learning loops for one completed turn.
 * opts.procedural gates the write side of loops 2–3 (mirrors PROCEDURAL_MEMORY env).
 * Returns what was captured/distilled so the caller can persist to encrypted stores.
 */
export function scheduleAfterTurn(
  ctx: TurnContext,
  opts: { procedural?: boolean; minCoverage?: number } = {},
): ScheduleResult {
  const { input, output, verified, coverage, task, steps, worth, traceId, model, latencyMs, now } = ctx
  const minCoverage = opts.minCoverage ?? 0.5
  const trace: Trace = { input, output, verified, coverage, decision: task, traceId, model, latencyMs }

  const isFailed = !verified || coverage < minCoverage || task === 'abstain'

  // Loop 1: eval-capture — failures become regression cases; successes sink to Langfuse for observability
  let evalCase: EvalCase | null = null
  if (isFailed) {
    evalCase = captureFailure(trace, now, { minCoverage })
  } else {
    captureProcedural(trace, now)
  }

  if (!opts.procedural || isFailed || worth < 0.6 || steps.length < 2) {
    return { path: isFailed ? 'failure' : 'skip', evalCase, skill: null, experience: null }
  }

  // Loop 2: procedural-memory — distill a skill and enroll it into SRS (loop 3) atomically
  // Abstraction includes both the router task type and content words from the input so that
  // jaccardSim retrieval can match against future queries with overlapping vocabulary.
  const rawSkill = distillSkill(input.slice(0, 120), `${task}: ${input.slice(0, 100)}`, steps)
  const skill: SkillWithCard = { ...rawSkill, card: newCard(now) }

  // Derive reliability-gate inputs from turn context:
  // gateDecision='answer' iff the turn was grounded and high-quality
  // replayClass='exact' iff a verifier tool (run_command/code_execute) ran; else 'best-effort'
  const gateDecision = verified && worth >= 0.6 ? 'answer' : null
  const replayClass = steps.some((s) => /run_command|code_execute|exec/i.test(s)) ? 'exact' : 'best-effort'

  const experience = distillExperience({
    task: input.slice(0, 200),
    steps,
    outcome: output.slice(0, 200),
    confidence: worth,
    gateDecision,
    replayClass,
  })

  return { path: 'success', evalCase: null, skill, experience }
}

/** Surface skills whose SRS card is due for review (same SM-2 interface as graph memory nodes). */
export function getSkillsDue<T extends { card: Card }>(items: T[], now: number): T[] {
  return dueCards(items, now)
}

/** Update a skill's SRS card after a review. grade: 0=again 1=hard 2=good 3=easy. */
export function reviewSkillCard(card: Card, grade: 0 | 1 | 2 | 3, now: number): Card {
  return srsReview(card, grade, now)
}

export interface UnifiedLearningStats {
  evalCases: number
  skills: number
  experiences: number
  skillsDue: number
}

/** Compute unified stats from raw record arrays. Counts only — no content crosses the boundary. */
export function unifiedStats(
  evalCases: unknown[],
  skills: Array<{ card?: Card }>,
  experiences: unknown[],
  now: number,
): UnifiedLearningStats {
  const skillsDue = skills.filter((s) => s.card !== undefined && (s.card as Card).due <= now).length
  return { evalCases: evalCases.length, skills: skills.length, experiences: experiences.length, skillsDue }
}
