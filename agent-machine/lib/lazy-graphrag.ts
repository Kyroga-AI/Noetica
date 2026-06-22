/**
 * lazy-graphrag.ts — LazyGraphRAG: defer all LLM summarization to query time. Instead of pre-built community
 * reports (expensive to build, stale on update), do a best-first traversal of the relevant subgraph from
 * query-matched seeds, bounded by a budget — matching global-search quality at ~0.1% index / ~4% query cost.
 * For a continually-updated local store, deferring the expensive work is a freshness + efficiency win.
 */
export interface Edge { to: string; rel: string }

/**
 * Best-first expansion: start at seeds, repeatedly expand the highest-relevance frontier node, collecting up
 * to `budget` nodes. relevance(node) is injected (embedding/lexical sim to the query). Returns visit order.
 */
export function lazySubgraph(
  adj: Map<string, Edge[]>,
  seeds: string[],
  relevance: (node: string) => number,
  opts: { budget?: number } = {},
): { nodes: string[]; order: Array<{ node: string; relevance: number }> } {
  const budget = opts.budget ?? 25
  const visited = new Set<string>()
  const order: Array<{ node: string; relevance: number }> = []
  // frontier as a simple array used as a priority queue (small graphs)
  const frontier: Array<{ node: string; r: number }> = seeds.map((s) => ({ node: s, r: relevance(s) }))
  while (frontier.length > 0 && visited.size < budget) {
    frontier.sort((a, b) => b.r - a.r)
    const { node, r } = frontier.shift()!
    if (visited.has(node)) continue
    visited.add(node)
    order.push({ node, relevance: Number(r.toFixed(4)) })
    for (const e of adj.get(node) ?? []) {
      if (!visited.has(e.to)) frontier.push({ node: e.to, r: relevance(e.to) })
    }
  }
  return { nodes: [...visited], order }
}
