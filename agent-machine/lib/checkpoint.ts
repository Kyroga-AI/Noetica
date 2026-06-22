/**
 * checkpoint.ts — durable / resumable agent execution (DBOS/Restate/LangGraph checkpointers). Persist state
 * after each step so a crashed or paused run resumes from the last completed step — not from scratch — and
 * side-effects aren't duplicated. The foundation for long-running, crash-survivable, HITL-gateable agents.
 */
export interface Checkpoint { runId: string; completed: string[]; state: Record<string, unknown> }

export function newCheckpoint(runId: string): Checkpoint { return { runId, completed: [], state: {} } }

/** Record a completed step (idempotent) + merge any state it produced. */
export function recordStep(cp: Checkpoint, stepId: string, state: Record<string, unknown> = {}): Checkpoint {
  if (cp.completed.includes(stepId)) return cp
  return { runId: cp.runId, completed: [...cp.completed, stepId], state: { ...cp.state, ...state } }
}

export function isDone(cp: Checkpoint, stepId: string): boolean { return cp.completed.includes(stepId) }

/** The steps still to run, in order — skipping ones already completed (resume point). */
export function remainingSteps(cp: Checkpoint, allSteps: string[]): string[] {
  const done = new Set(cp.completed)
  return allSteps.filter((s) => !done.has(s))
}

export function isComplete(cp: Checkpoint, allSteps: string[]): boolean {
  return remainingSteps(cp, allSteps).length === 0
}
