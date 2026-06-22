/**
 * isochrone.ts — travel-time reachability (Mapbox/Valhalla isochrone role). "Where could entity X be within
 * N minutes?" via Dijkstra over a routing graph with edge TIME costs — a feasibility/alibi primitive our
 * straight-line graph paths can't answer (they ignore the road network and the clock). Routing graph injected.
 */
export interface TimedEdge { to: string; minutes: number }

/** Dijkstra: all nodes reachable from source within budgetMin, with their shortest travel time. */
export function reachableWithin(graph: Map<string, TimedEdge[]>, source: string, budgetMin: number): Array<{ node: string; minutes: number }> {
  const best = new Map<string, number>([[source, 0]])
  const pq: Array<{ node: string; t: number }> = [{ node: source, t: 0 }]
  while (pq.length > 0) {
    pq.sort((a, b) => a.t - b.t)
    const { node, t } = pq.shift()!
    if (t > (best.get(node) ?? Infinity)) continue
    for (const e of graph.get(node) ?? []) {
      const nt = t + e.minutes
      if (nt <= budgetMin && nt < (best.get(e.to) ?? Infinity)) {
        best.set(e.to, nt)
        pq.push({ node: e.to, t: nt })
      }
    }
  }
  return [...best.entries()].filter(([n]) => n !== source).map(([node, minutes]) => ({ node, minutes: Number(minutes.toFixed(2)) })).sort((a, b) => a.minutes - b.minutes)
}

/** Could an entity plausibly travel A→B in the elapsed time? (feasibility / alibi check) */
export function isFeasibleTrip(graph: Map<string, TimedEdge[]>, from: string, to: string, elapsedMin: number): boolean {
  return reachableWithin(graph, from, elapsedMin).some((r) => r.node === to)
}
