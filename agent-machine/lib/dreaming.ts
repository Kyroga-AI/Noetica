/**
 * dreaming.ts — generative offline consolidation ("dreaming", SCM REM phase; OpenAI dreaming). Not
 * summarization — INFERENCE: during idle time, run random walks over high-importance seeds to surface novel
 * candidate edges between concepts that co-occur on walks but aren't directly linked. Integrate only ones
 * that pass the grounding-verifier (caller's gate). The walk is deterministic given an injected picker, so
 * it's testable; pass a seeded RNG-based picker in production.
 */
export interface Edge { to: string; rel: string }
export interface DreamedEdge { from: string; to: string; via: string[]; support: number }

/**
 * For each seed, walk `length` steps picking the next neighbour via `pick(candidates, stepIndex)`; the walk's
 * endpoints become a candidate edge if not already directly connected. Aggregates support across walks.
 */
export function dreamEdges(
  adj: Map<string, Edge[]>,
  seeds: string[],
  pick: (candidates: Edge[], step: number) => number,
  opts: { length?: number; walksPerSeed?: number } = {},
): DreamedEdge[] {
  const length = opts.length ?? 4
  const walksPerSeed = opts.walksPerSeed ?? 1
  const direct = new Set<string>()
  for (const [from, edges] of adj) for (const e of edges) direct.add(`${from}|${e.to}`)
  const proposals = new Map<string, DreamedEdge>()
  for (const seed of seeds) {
    for (let w = 0; w < walksPerSeed; w++) {
      let node = seed
      const path = [seed]
      for (let step = 0; step < length; step++) {
        const cands = adj.get(node) ?? []
        if (cands.length === 0) break
        const idx = ((pick(cands, step + w) % cands.length) + cands.length) % cands.length
        node = cands[idx]!.to
        if (path.includes(node)) break
        path.push(node)
      }
      const end = path[path.length - 1]!
      if (end !== seed && !direct.has(`${seed}|${end}`) && !direct.has(`${end}|${seed}`)) {
        const key = seed < end ? `${seed}|${end}` : `${end}|${seed}`
        const rec = proposals.get(key) ?? proposals.set(key, { from: seed, to: end, via: path.slice(1, -1), support: 0 }).get(key)!
        rec.support++
      }
    }
  }
  return [...proposals.values()].sort((a, b) => b.support - a.support)
}
