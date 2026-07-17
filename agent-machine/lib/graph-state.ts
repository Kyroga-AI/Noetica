/**
 * Graph-RL — graph-state featurization.
 *
 * The context vector a contextual bandit (grl-policy.ts) conditions on when it CHOOSES a
 * capability action (which retrieval mode, which reasoning route) for a query. This is what
 * makes the RL loop *graph*-native: the state is the shape of the HellGraph neighbourhood the
 * query lands in — how much of it is verified vs hypothesised, how big, how concentrated —
 * not just opaque task features.
 *
 * Pure + dependency-injected: it takes already-computed signals (the wiring layer supplies them
 * from graph-analytics / graph-surface) and returns a fixed-dimension normalized vector, so it is
 * trivially testable and never reaches into the engine itself.
 */

/** The raw graph signals for a query's neighbourhood, gathered by the serving path. */
export interface GraphState {
  /** Count of candidate nodes per epistemic mode (shared ladder w/ Lattice Studio). */
  epistemic: Partial<Record<'verified' | 'attested' | 'observed' | 'derived' | 'hypothesis' | 'unknown', number>>
  /** Total candidate nodes in the query's subgraph. */
  subgraphSize: number
  /** Total candidate edges (relationships available to traverse). */
  edgeCount: number
  /** Share of mass on the single highest-PPR/degree node in [0,1] — topical concentration. */
  topNodeShare: number
  /** Did the query match at least one canon-grounded (verified/attested) node? */
  grounded: boolean
  /** Query length in tokens (specificity proxy). */
  queryTokens: number
}

/** Fixed context dimension. Bias + 4 epistemic fractions + size + edge-density + concentration + grounding + specificity. */
export const GRAPH_STATE_DIM = 10

const EPI_TRUST = ['verified', 'attested', 'observed', 'derived', 'hypothesis', 'unknown'] as const

/** Total candidate nodes counted across epistemic buckets (defensive against a size that lags the buckets). */
function epistemicTotal(gs: GraphState): number {
  return EPI_TRUST.reduce((s, k) => s + (gs.epistemic[k] ?? 0), 0)
}

/**
 * Featurize a GraphState into a normalized context vector in roughly [0,1] per component.
 * Order is stable — LinUCB weights are indexed positionally, so never reorder without a reset.
 */
export function featurizeGraphState(gs: GraphState): number[] {
  const nodes = Math.max(epistemicTotal(gs), gs.subgraphSize, 0)
  const denom = Math.max(nodes, 1)
  const frac = (k: (typeof EPI_TRUST)[number]) => (gs.epistemic[k] ?? 0) / denom
  // verified + attested collapse into one "high-trust" fraction; the rest stay distinct.
  const highTrust = frac('verified') + frac('attested')
  const observed = frac('observed')
  const derived = frac('derived')
  const hypothesis = frac('hypothesis')
  // Edge density normalized by a plausible cap (2 = fairly dense for a small ego-graph).
  const density = clamp01(gs.edgeCount / Math.max(nodes, 1) / 2)
  return [
    1, // bias / intercept
    highTrust,
    observed,
    derived,
    hypothesis,
    clamp01(Math.log1p(nodes) / Math.log1p(200)), // size, log-compressed against a 200-node reference
    density,
    clamp01(gs.topNodeShare),
    gs.grounded ? 1 : 0,
    clamp01(gs.queryTokens / 40), // specificity against a 40-token reference
  ]
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0
}
