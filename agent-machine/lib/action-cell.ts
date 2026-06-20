/**
 * action-cell — the (topic × action) cell of the operational intent algebra: a tangent
 * vector on the topic manifold (where you are × what you do) carrying its admissibility
 * cone (the fidelity bar, §10.1 Law), a polarity-derived route, and a SEAM-C attestation.
 *
 * This is the LOCAL field that meshrush integrates globally. A cell must know two things
 * before any flow can cross it: (1) is this tangent direction VALID at this topic, and
 * if not, WHY (empties are signal, §6); (2) which mesh node realizes it — derived, not
 * looked up, from the action's polarity (read=covector→interactive/faithful; write=
 * vector→deliberate/generative) and substrate (store→RAG, held→model, world→sensor/exec).
 * The polarity route is the two-day latency+hallucination finding made structural.
 */
import { ACTION_SIGNATURE, type Substrate, type Polarity } from './verb-sort.js'
import { ledgerHash } from './verb-sort.js'

// §10.1 — a fidelity bar is a sparse, declarative constraint: what it requires, why,
// and how it could be falsified (mirrors the manuscript's constraint-family discipline).
export interface Constraint {
  requires: string          // the context that must be present (fabric/buffer key, doc, slot…)
  rationale: string         // why this action needs it to be worthwhile
  falsifiedBy: string       // the observable condition under which the constraint fails
}

export type DispatchTier = 'interactive' | 'deliberate'
export interface ActionRoute { tier: DispatchTier; target: string }

export interface ActionCell {
  topic: string
  action: string
  substrate: Substrate
  polarity: Polarity
  valid: boolean
  emptyReason?: string      // present iff !valid — the signal a topic doesn't carry this op
  fidelityBar: Constraint[] // the admissibility cone, localized to this cell
  route: ActionRoute        // polarity+substrate derived
  attestation: string       // SEAM-C content hash
}

/**
 * Polarity-derived route — the speedup, grounded in the geometry. A `read` is a covector
 * (pulls existing state → cannot hallucinate → interactive/faithful tier). A `write` is a
 * vector (generates new state → can drift → deliberate/generative tier). The substrate
 * names the concrete mesh node. No 22-bucket classify-then-lookup — one bit + three ways.
 */
const ROUTE: Record<`${Substrate}:${Polarity}`, ActionRoute> = {
  'store:read': { tier: 'interactive', target: 'rag' },          // retrieve — semantic/extractive
  'store:write': { tier: 'deliberate', target: 'writer' },       // create   — persist/author
  'held:read': { tier: 'interactive', target: 'vj' },            // evaluate  — value judgment (read held state)
  'held:write': { tier: 'deliberate', target: 'generator' },     // transform — the language model
  'world:read': { tier: 'interactive', target: 'capture' },      // sense     — sensor/STT (the +1 column)
  'world:write': { tier: 'deliberate', target: 'executor' },     // execute   — tools/code/file ops
}
export function routeForAction(action: string): ActionRoute {
  const sig = ACTION_SIGNATURE[action]
  if (!sig) return { tier: 'deliberate', target: 'generator' } // unknown ⇒ safest (generative) tier
  return ROUTE[`${sig.substrate}:${sig.polarity}`]
}

/**
 * MeshRush phase for an action — the connection to the graph-native runtime
 * (lib/meshrush-bridge.ts). "Diffuse before crystallize" is the read-before-write
 * doctrine: the read covectors are the diffuse half (observe→diffuse→stop), the
 * write vectors the crystallize half (crystallize→execute). The action surface of
 * the chat dispatcher and the MeshRush loop are thus ONE thing.
 */
export type MeshRushPhase = 'observe' | 'diffuse' | 'stop' | 'crystallize' | 'execute'
const MESHRUSH_PHASE: Record<string, MeshRushPhase> = {
  sense: 'observe',       // world:read — seed the graph view (extractSubgraph from GAIA)
  retrieve: 'diffuse',    // store:read — explore the view (PatternMatcher)
  evaluate: 'stop',       // held:read  — stopDecision / value judgment
  create: 'crystallize',  // store:write — commit a durable artifact
  transform: 'crystallize', // held:write — compile committed structure
  execute: 'execute',     // world:write — governed ExecutionCandidate (agentplane)
}
export function meshrushPhase(action: string): MeshRushPhase | null {
  return MESHRUSH_PHASE[action] ?? null
}

/** Build a cell. `valid`/`emptyReason` are supplied by the validity predicate (derived
 *  per-topic); the route + attestation are derived here so the field is self-describing. */
export function makeCell(opts: {
  topic: string; action: string; valid: boolean; emptyReason?: string; fidelityBar?: Constraint[]
}): ActionCell {
  const sig = ACTION_SIGNATURE[opts.action]
  if (!sig) throw new Error(`unknown action ${opts.action} — not in the 6-column basis`)
  const route = routeForAction(opts.action)
  const fidelityBar = opts.valid ? (opts.fidelityBar ?? []) : []
  const attestation = ledgerHash({ topic: opts.topic, action: opts.action, valid: opts.valid, route, bar: fidelityBar })
  return {
    topic: opts.topic, action: opts.action, substrate: sig.substrate, polarity: sig.polarity,
    valid: opts.valid, emptyReason: opts.valid ? undefined : (opts.emptyReason ?? 'no rationale given'),
    fidelityBar, route, attestation,
  }
}

/** A cell's bar CLEARS when the context satisfies every constraint — dispatch is then the
 *  projection onto the cone. Returns the residual (unmet constraints); empty ⇒ clear. */
export function clears(cell: ActionCell, contextHas: (key: string) => boolean): { clear: boolean; residual: Constraint[] } {
  const residual = cell.fidelityBar.filter((c) => !contextHas(c.requires))
  return { clear: residual.length === 0, residual }
}

export const ACTION_COLUMNS = ['retrieve', 'create', 'evaluate', 'transform', 'sense', 'execute'] as const
