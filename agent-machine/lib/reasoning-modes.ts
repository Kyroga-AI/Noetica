/**
 * reasoning-modes.ts — test-time-compute controls. Budget-forcing (s1, arXiv 2501.19393): a runtime knob on
 * HOW MUCH the model thinks — extend with "Wait" to self-check, or truncate to cap latency. Chain-of-Draft
 * (arXiv 2502.18600): compress each reasoning step to a terse draft (~7% of CoT tokens at comparable accuracy).
 */

/** Decide whether to keep thinking, force one more self-check, or stop, given the token budget. */
export function budgetStep(tokensUsed: number, budget: number, opts: { minThink?: number } = {}): 'continue' | 'wait' | 'stop' {
  const minThink = opts.minThink ?? Math.floor(budget * 0.25)
  if (tokensUsed < minThink) return 'continue'
  if (tokensUsed >= budget) return 'stop'
  // in the upper band, nudge one extra verification pass before stopping
  return tokensUsed >= budget * 0.85 ? 'wait' : 'continue'
}

/** Compress a verbose reasoning step into a terse draft of at most maxWords words. */
export function toDraft(step: string, maxWords = 8): string {
  const words = step.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  return words.slice(0, maxWords).join(' ')
}

export function draftChain(steps: string[], maxWords = 8): string[] {
  return steps.map((s) => toDraft(s, maxWords)).filter((s) => s.length > 0)
}
