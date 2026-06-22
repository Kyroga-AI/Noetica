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

export function successRate(s: Skill): number { return s.uses === 0 ? 0.5 : s.successes / s.uses }

export function recordUse(s: Skill, success: boolean): Skill {
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
