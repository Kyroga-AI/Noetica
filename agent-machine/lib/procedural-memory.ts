/**
 * procedural-memory.ts — the skill-library gap (Voyager/Memₚ/LangMem). All our memory is DECLARATIVE (facts);
 * none captures HOW the agent does things well. Distill a successful trajectory into a reusable skill stored
 * as an LLM ABSTRACTION (not a raw embedding — the Nov-2025 benchmark shows embeddings hit a −30pp
 * generalization cliff on procedures). Retrieve by task; track success to prefer what works.
 */
export interface Skill { id: string; task: string; abstraction: string; steps: string[]; uses: number; successes: number }

let _seq = 0
/** Build a skill from a completed trajectory. `abstraction` should be an LLM-written generalization of the task. */
export function distillSkill(task: string, abstraction: string, steps: string[]): Skill {
  return { id: `skill-${_seq++}`, task, abstraction, steps, uses: 0, successes: 0 }
}

/** success rate over any uses/successes-tracked record (Skill or ReasoningExperience). */
export function successRate(s: { uses: number; successes: number }): number { return s.uses === 0 ? 0.5 : s.successes / s.uses }

export function recordUse<T extends { uses: number; successes: number }>(s: T, success: boolean): T {
  return { ...s, uses: s.uses + 1, successes: s.successes + (success ? 1 : 0) }
}

/** Retrieve skills for a task, ranked by relevance × success rate (match fn injected — LLM/embedding sim). */
export function retrieveSkills(task: string, skills: Skill[], match: (a: string, b: string) => number, opts: { topK?: number; minMatch?: number } = {}): Array<Skill & { relevance: number }> {
  const topK = opts.topK ?? 3, minMatch = opts.minMatch ?? 0.2
  return skills
    .map((s) => ({ ...s, relevance: match(task, s.abstraction || s.task) }))
    .filter((s) => s.relevance >= minMatch)
    .sort((a, b) => (b.relevance * (0.5 + successRate(b))) - (a.relevance * (0.5 + successRate(a))))
    .slice(0, topK)
}

// ─── Reasoning-trajectory experience (the AgentKB gap) ──────────────────────────
// A Skill abstracts the ACTION-TYPE sequence (['retrieve','generate','verify']); it does not carry the actual
// reasoning STEPS taken on a real task. The reasoning-evidence fabric (ReasoningRun/Event/Receipt) DOES hold
// those, but it is write-only — emitted to disk and never read back. A ReasoningExperience closes that loop:
// the ordered event summaries of a SOLVED run, retrievable to warm-start a similar new task (AgentKB's
// "Reason-Retrieve-Refine" over past reasoning paths).
//
// THE MOAT vs AgentKB: their experience store is unverified — "what worked before" propagates plausible-but-wrong
// reasoning. Ours is GATED. A trajectory is promotable ONLY if the reliability gate decided `answer` AND the
// receipt's replayClass is `exact` (deterministic/computed) or `best-effort` (a real reasoning/compute result) —
// never `evidence-only` / `non-replayable-side-effect` (observations & external mutations are not reasoning to
// reuse). So the store holds verified procedural memory, not trajectory mimicry. Fail-closed: anything that did
// not clear the gate is dropped, never stored.
export type ExperienceReplayClass = 'exact' | 'best-effort' | 'evidence-only' | 'non-replayable-side-effect'

export interface ReasoningExperience {
  id: string
  task: string                    // the query/intent that was solved (truncated, safe-trace)
  steps: string[]                 // ordered reasoning-event summaries from the run (the path)
  outcome: string                 // short outcome / answer summary
  confidence: number              // reliability-gate calibrated P(correct) at promotion time
  replayClass: ExperienceReplayClass
  uses: number
  successes: number
}

/** The STRICT promotion gate. A trajectory enters the verified-experience store ONLY when the reliability gate
 *  answered (not escalated) AND the receipt is a real reasoning/compute result (exact | best-effort). This is
 *  the verified-vs-mimicry line — keep it fail-closed. */
export function isPromotableTrajectory(gateDecision: string | null | undefined, replayClass: string | null | undefined): boolean {
  return gateDecision === 'answer' && (replayClass === 'exact' || replayClass === 'best-effort')
}

/** Distill a closed ReasoningRun into a verified experience — or null (dropped) if it fails the strict gate.
 *  `steps` are the run's event summaries in order; keep only the substantive ones (cap to avoid prompt bloat). */
export function distillExperience(args: {
  task: string
  steps: string[]
  outcome: string
  confidence: number
  gateDecision: string | null | undefined
  replayClass: string | null | undefined
  maxSteps?: number
}): ReasoningExperience | null {
  if (!isPromotableTrajectory(args.gateDecision, args.replayClass)) return null   // fail-closed
  const steps = (args.steps || []).map((s) => String(s).trim()).filter(Boolean).slice(0, args.maxSteps ?? 8)
  if (!steps.length) return null   // no path to reuse
  return {
    id: `rexp-${_seq++}`,
    task: String(args.task ?? '').slice(0, 200),
    steps,
    outcome: String(args.outcome ?? '').slice(0, 200),
    confidence: Number.isFinite(args.confidence) ? args.confidence : 0.5,
    replayClass: args.replayClass as ExperienceReplayClass,
    uses: 0,
    successes: 0,
  }
}

/** Retrieve experiences for a task, ranked by relevance × success rate × confidence. Same injected-match shape
 *  as retrieveSkills (Jaccard / embedding cosine — caller's choice), so it shares the proven retrieval path. */
export function retrieveExperiences(task: string, store: ReasoningExperience[], match: (a: string, b: string) => number, opts: { topK?: number; minMatch?: number } = {}): Array<ReasoningExperience & { relevance: number }> {
  const topK = opts.topK ?? 3, minMatch = opts.minMatch ?? 0.2
  return store
    .map((e) => ({ ...e, relevance: match(task, e.task) }))
    .filter((e) => e.relevance >= minMatch)
    .sort((a, b) => (b.relevance * (0.5 + successRate(b)) * (0.5 + b.confidence)) - (a.relevance * (0.5 + successRate(a)) * (0.5 + a.confidence)))
    .slice(0, topK)
}

/** Render retrieved experiences as a compact prompt block. NOT raw few-shot for a 7B to ignore — this is the
 *  "reasoning from similar verified tasks" context the compute/council path conditions on. */
export function renderExperiences(hits: Array<ReasoningExperience & { relevance: number }>): string {
  if (!hits.length) return ''
  const lines = hits.map((h, i) => `${i + 1}. (${h.replayClass}, P≈${h.confidence.toFixed(2)}) ${h.task}\n   path: ${h.steps.join(' → ')}\n   → ${h.outcome}`)
  return `\n\n---\n**Reasoning from similar verified tasks** (promoted only after passing the reliability gate):\n${lines.join('\n')}\n---\n`
}
