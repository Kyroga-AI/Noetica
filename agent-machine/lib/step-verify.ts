/**
 * step-verify.ts — process-reward step search (Lightman 2023 "Let's Verify Step by Step"; Math-Shepherd auto
 * labels). Move scoring from the final answer to EACH reasoning step: prune bad partial reasoning early via
 * step-level beam search, and estimate a step's value by the success rate of Monte-Carlo rollouts from it —
 * which our deterministic verifier can label for free (verifier as the rollout oracle). Caller supplies
 * expand + score; this is the search.
 */
export interface Step { text: string; score: number }

/** Math-Shepherd value: a step's worth = fraction of rollouts from it that reach a verifier-correct answer. */
export function stepValue(rolloutCorrect: boolean[]): number {
  if (rolloutCorrect.length === 0) return 0
  return rolloutCorrect.filter(Boolean).length / rolloutCorrect.length
}

/**
 * Step-level beam search: keep the top-`beam` partial reasoning paths by cumulative step score, pruning the
 * rest early (>4× more compute-efficient than best-of-N on hard problems). expand returns candidate next
 * steps for a path; score rates a full path.
 */
export function stepBeamSearch(
  start: Step[],
  expand: (path: Step[]) => Step[],
  scorePath: (path: Step[]) => number,
  opts: { beam?: number; depth?: number } = {},
): Step[][] {
  const beam = opts.beam ?? 3
  const depth = opts.depth ?? 4
  let frontier: Step[][] = [start]
  for (let d = 0; d < depth; d++) {
    const next: Array<{ path: Step[]; s: number }> = []
    for (const path of frontier) {
      const cands = expand(path)
      if (cands.length === 0) { next.push({ path, s: scorePath(path) }); continue }
      for (const c of cands) { const np = [...path, c]; next.push({ path: np, s: scorePath(np) }) }
    }
    if (next.length === 0) break
    next.sort((a, b) => b.s - a.s)
    frontier = next.slice(0, beam).map((x) => x.path)
  }
  return frontier
}
