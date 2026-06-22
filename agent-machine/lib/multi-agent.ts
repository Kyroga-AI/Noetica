/**
 * multi-agent.ts — supervisor / orchestrator-worker decomposition + aggregation (Anthropic multi-agent,
 * +90.2% over single-agent). Breaks the single-context-window ceiling: a lead decomposes a task into
 * independent subtasks, each running in its OWN context (and, via our mesh ladder, its own model tier), then
 * results are synthesized. This module is the routing + aggregation skeleton; the agent runs are the caller's.
 */
export interface SubTask { id: string; objective: string; tier: 'local' | 'sovereign' | 'frontier' }

/** Decompose into subtasks, routing each to a mesh tier by a (caller-supplied) difficulty estimate 0..1. */
export function decompose(parts: Array<{ objective: string; difficulty?: number }>): SubTask[] {
  return parts.map((p, i) => {
    const d = p.difficulty ?? 0.3
    const tier: SubTask['tier'] = d >= 0.75 ? 'frontier' : d >= 0.4 ? 'sovereign' : 'local'
    return { id: `sub-${i}`, objective: p.objective, tier }
  })
}

export interface SubResult { id: string; output: string; confidence?: number }

/** Synthesize worker results: order by confidence, report mean confidence + non-empty coverage. */
export function aggregate(results: SubResult[]): { ordered: SubResult[]; meanConfidence: number; coverage: number } {
  const valid = results.filter((r) => r.output && r.output.trim().length > 0)
  const ordered = [...valid].sort((a, b) => (b.confidence ?? 0.5) - (a.confidence ?? 0.5))
  const meanConfidence = valid.length ? valid.reduce((s, r) => s + (r.confidence ?? 0.5), 0) / valid.length : 0
  return { ordered, meanConfidence: Number(meanConfidence.toFixed(3)), coverage: results.length ? valid.length / results.length : 0 }
}
