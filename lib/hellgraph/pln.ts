/**
 * PLN — Probabilistic Logic Networks forward chaining for HellGraph.
 *
 * Implements a focused subset of PLN's deduction rule over the RELATED_TO
 * edge type in the FeatureAtom metagraph:
 *
 *   Deduction rule (2-hop):
 *     A -[RELATED_TO]-> B  (strength p1, confidence c1)
 *     B -[RELATED_TO]-> C  (strength p2, confidence c2)
 *     ────────────────────────────────────────────────
 *     A -[RELATED_TO]-> C  (strength p1*p2, confidence c1*c2*0.9)
 *
 * Only derives new edges with strength >= MIN_STRENGTH.
 * Stops after MAX_ITERS to bound runtime per ingest cycle.
 *
 * The sidecar (OpenCog PLN) handles full URE-backed chaining with all rules.
 * This TypeScript path is the fast, in-process fallback for zero-latency inference.
 */

import { getHellGraph } from './store'

const MIN_STRENGTH  = 0.30
const MAX_ITERS     = 80
const CHAIN_EDGE    = 'RELATED_TO'

export interface PLNResult {
  derived:     number
  rulesFired:  number
  iterations:  number
}

/**
 * Run PLN forward chaining to depth 2 over RELATED_TO edges.
 * Returns counts of newly derived edges and rule applications.
 */
export function forwardChain(): PLNResult {
  const g = getHellGraph()
  const allEdges = g.allEdges().filter(e => e.label === CHAIN_EDGE)

  // Build adjacency: from → [{to, strength, confidence}]
  type Neighbor = { to: string; s: number; c: number }
  const adj = new Map<string, Neighbor[]>()
  for (const e of allEdges) {
    if (!adj.has(e.from)) adj.set(e.from, [])
    adj.get(e.from)!.push({
      to: e.to,
      s:  Number(e.properties['confidence'] ?? 0.5),
      c:  Number(e.properties['confidence'] ?? 0.5),
    })
  }

  let derived    = 0
  let rulesFired = 0
  let changed    = true
  let iters      = 0

  while (changed && iters < MAX_ITERS) {
    changed = false
    iters++

    for (const [a, aNeighbors] of adj) {
      for (const { to: b, s: p1, c: c1 } of aNeighbors) {
        const bNeighbors = adj.get(b) ?? []
        for (const { to: cc, s: p2, c: c2 } of bNeighbors) {
          if (cc === a) continue                     // no self-loop
          const inferredS = p1 * p2
          const inferredC = c1 * c2 * 0.9           // slight confidence penalty per hop
          if (inferredS < MIN_STRENGTH) continue

          // Skip if a stronger direct edge already exists
          const existing = adj.get(a)?.find(n => n.to === cc)
          if (existing && existing.s >= inferredS) continue

          const now = new Date().toISOString()
          g.addEdge(CHAIN_EDGE, a, cc, {
            epistemicClass:  'pln_deduction',
            confidence:      inferredS,
            promotionState:  'inferred',
            createdAt:       now,
          })
          rulesFired++
          derived++
          changed = true

          // Update local adj so chaining can continue in same iteration
          if (!adj.has(a)) adj.set(a, [])
          const aAdj = adj.get(a)!
          const existIdx = aAdj.findIndex(n => n.to === cc)
          if (existIdx >= 0) {
            aAdj[existIdx]!.s = inferredS
            aAdj[existIdx]!.c = inferredC
          } else {
            aAdj.push({ to: cc, s: inferredS, c: inferredC })
          }
        }
      }
    }
  }

  return { derived, rulesFired, iterations: iters }
}
