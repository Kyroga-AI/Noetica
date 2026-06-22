/**
 * plan-mode.ts — plan-then-execute approval gate (Claude Code Plan Mode / Magentic-One ledger). Before the
 * agent acts, it emits an editable step plan the user can prune + approve; execution runs "exactly what was
 * agreed". A pre-execution steering surface, distinct from a post-hoc digest. Extends our kill-switch into a
 * positive approve-before-act gate (and answers the EU AI Act human-oversight requirement).
 */
export interface PlanStep { id: number; text: string; status: 'pending' | 'removed' | 'done' }
export interface Plan { steps: PlanStep[]; approved: boolean }

export function makePlan(steps: string[]): Plan {
  return { steps: steps.map((text, id) => ({ id, text, status: 'pending' })), approved: false }
}

export function editPlan(plan: Plan, edits: { remove?: number[]; approve?: boolean }): Plan {
  const removeSet = new Set(edits.remove ?? [])
  return {
    steps: plan.steps.map((s) => (removeSet.has(s.id) ? { ...s, status: 'removed' as const } : s)),
    approved: edits.approve ?? plan.approved,
  }
}

/** The next executable step = first approved-plan step still pending. Null if none / not approved. */
export function nextStep(plan: Plan): PlanStep | null {
  if (!plan.approved) return null
  return plan.steps.find((s) => s.status === 'pending') ?? null
}

export function completeStep(plan: Plan, id: number): Plan {
  return { ...plan, steps: plan.steps.map((s) => (s.id === id ? { ...s, status: 'done' } : s)) }
}

export function canExecute(plan: Plan): boolean {
  return plan.approved && plan.steps.some((s) => s.status === 'pending')
}
