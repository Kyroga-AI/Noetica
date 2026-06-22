/**
 * think-on-graph.ts — iterative beam-search traversal over graph triples (Think-on-Graph, Sun et al. 2023).
 * Alternates expand (retrieve neighbours) and prune (keep top-beam paths by a relevance score) for agentic
 * multi-hop reasoning that interleaves retrieval and thinking — distinct from one-shot GraphRAG. The scorer
 * is injected, so an LLM (or embedding relevance) plugs in as the prune step while the search stays testable.
 */
export interface Edge { to: string; rel: string }
export interface Path { nodes: string[]; rels: string[]; score: number }

export function beamTraverse(
  adj: Map<string, Edge[]>,
  seeds: string[],
  score: (path: Path) => number,
  opts: { beam?: number; depth?: number } = {},
): Path[] {
  const beam = opts.beam ?? 4
  const depth = opts.depth ?? 3
  let frontier: Path[] = seeds.map((s) => ({ nodes: [s], rels: [], score: 0 }))
  const visited = new Set(seeds)
  const all: Path[] = []
  for (let d = 0; d < depth; d++) {
    const expanded: Path[] = []
    for (const path of frontier) {
      const last = path.nodes[path.nodes.length - 1]!
      for (const e of adj.get(last) ?? []) {
        if (path.nodes.includes(e.to)) continue   // no cycles within a path
        const np: Path = { nodes: [...path.nodes, e.to], rels: [...path.rels, e.rel], score: 0 }
        np.score = score(np)
        expanded.push(np)
      }
    }
    if (expanded.length === 0) break
    expanded.sort((a, b) => b.score - a.score)
    frontier = expanded.slice(0, beam)
    for (const p of frontier) { all.push(p); visited.add(p.nodes[p.nodes.length - 1]!) }
  }
  return all.sort((a, b) => b.score - a.score)
}
