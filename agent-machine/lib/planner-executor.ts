/**
 * planner-executor.ts — Magentic-One orchestrator pattern: a Task Ledger (known vs assumed facts) + a
 * Progress Ledger (per-step "are we advancing?" check + stall counter) that triggers reflective RE-PLANNING
 * instead of spinning. A flat tool loop has no "we're stuck" concept and burns steps until a cap.
 */
export interface TaskLedger { known: string[]; assumed: string[]; goal: string }
export interface ProgressLedger { stalls: number; lastSignature: string }

export function newProgress(): ProgressLedger { return { stalls: 0, lastSignature: '' } }

/** A coarse signature of execution state; identical signatures across steps = no progress. */
export function stateSignature(facts: string[]): string {
  return [...new Set(facts)].sort().join('|')
}

/** Update the progress ledger after a step. No change in state ⇒ increment the stall counter. */
export function recordProgress(progress: ProgressLedger, facts: string[]): ProgressLedger {
  const sig = stateSignature(facts)
  if (sig === progress.lastSignature) return { stalls: progress.stalls + 1, lastSignature: sig }
  return { stalls: 0, lastSignature: sig }
}

/** Replan when stalled at least maxStalls times (Magentic-One uses 2). */
export function shouldReplan(progress: ProgressLedger, maxStalls = 2): boolean {
  return progress.stalls >= maxStalls
}

/** Promote assumed facts to known when confirmed; keeps the ledger's epistemic split honest. */
export function confirmFact(ledger: TaskLedger, fact: string): TaskLedger {
  return { ...ledger, known: [...new Set([...ledger.known, fact])], assumed: ledger.assumed.filter((f) => f !== fact) }
}
