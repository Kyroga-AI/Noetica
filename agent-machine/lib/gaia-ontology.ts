/**
 * gaia-ontology.ts — the GAIA Ontogenesis Stewardship Graph ontology (IOES: Identity, Ontogenesis,
 * Ecology, Stewardship), vendored from regis-entity-graph/docs/30_GAIA_ONTOGENESIS_STEWARDSHIP_GRAPH.md.
 *
 * This is the canonical entity ontology we dogfood (like slash-topics + the regis contracts). It defines
 * the node/edge kinds, developmental phases, and abandonment signals for governed, living knowledge — and
 * critically, it maps onto the GDS we already compute: orphans → orphaned_artifact, bridges → transmission
 * phase / critical dependency, ungrounded claims → stale_evidence. So Noetica's structural analysis can
 * speak the GAIA ontology instead of an ad-hoc vocabulary.
 */

export const GAIA_NODE_KINDS = [
  'LIVING_ENTITY', 'ONTOGENESIS_STATE', 'GAIA_DEPENDENCY_RECORD', 'STEWARDSHIP_RECORD', 'KEEPER_LOG',
  'SUCCESSION_RULE', 'ABANDONMENT_SIGNAL', 'LEARNING_ARTIFACT', 'DELIVERY_OUTCOME_RECORD', 'POLICY_DECISION',
  'CONSENT_RECEIPT', 'PROJECTION_RECORD',
] as const

export const GAIA_EDGE_KINDS = [
  'STEWARD_OF', 'GUARDIAN_OF', 'MENTOR_OF', 'APPRENTICE_OF', 'SUCCESSOR_OF', 'PRESERVES', 'TRANSMITS_TO',
  'CARES_FOR', 'HAS_KEEPER_LOG', 'HAS_SUCCESSION_RULE', 'HAS_ABANDONMENT_SIGNAL', 'HAS_ONTOGENESIS_STATE',
  'DEPENDS_ON', 'CONTRIBUTES_TO', 'IMPACTS', 'CO_EVOLVES_WITH', 'REGENERATES', 'DEGRADES',
  'AUTHORIZED_BY_CONSENT', 'ALLOWED_BY_POLICY', 'DENIED_BY_POLICY', 'ATTESTED_BY_PROOF', 'EMITTED_BY_EXECUTION',
  'HAS_DELIVERY_OUTCOME', 'HAS_LEARNING_CHANGESET',
] as const

// A LIVING_ENTITY's developmental phase (OntogenesisState).
export const ONTOGENESIS_PHASES = ['seed', 'formation', 'growth', 'maturity', 'transmission', 'transformation', 'decline', 'succession', 'archive', 'termination'] as const
export type OntogenesisPhase = typeof ONTOGENESIS_PHASES[number]

// Risk that stewardship is failing — abandonment is a GRAPH STATE, not absence of data.
export const ABANDONMENT_SIGNALS = ['no_active_keeper', 'no_successor', 'review_overdue', 'broken_contact', 'stale_evidence', 'contested_authority', 'critical_dependency_failed', 'orphaned_artifact'] as const
export type AbandonmentSignal = typeof ABANDONMENT_SIGNALS[number]

export const DEPENDENCY_TYPES = ['community', 'family', 'education', 'energy', 'water', 'food', 'infrastructure', 'software', 'compute', 'language', 'standards', 'evidence_source', 'jurisdiction', 'ecosystem'] as const

// Key invariants from the contract (advisory — surfaced so consumers honor them).
export const GAIA_INVARIANTS = [
  'Stewardship must not imply ownership without a separate ownership/authority artifact.',
  'Model inference alone must not promote developmental state to canonical human-impacting truth.',
  'Material dependencies must not be stripped merely to simplify projection.',
  'A stewardship record without an active keeper becomes needs_review or orphaned, not silently healthy.',
  'Abandonment is a graph state, not absence of graph data.',
] as const

/** Map a node's GDS structural state to its GAIA developmental phase. */
export function ontogenesisPhase(s: { degree: number; pagerank: number; betweenness: number; community: number }): OntogenesisPhase {
  if (s.degree === 0 || s.community < 0) return 'seed'        // not yet woven into the ecology
  if (s.betweenness >= 0.4) return 'transmission'             // a connector that transmits between communities
  if (s.pagerank >= 0.5) return 'maturity'                    // load-bearing, well-established
  if (s.degree <= 2) return 'formation'                       // still forming its connections
  return 'growth'
}

/** Detect GAIA abandonment signals from a node's structural state (+ grounding when known). */
export function abandonmentSignals(s: { degree: number; pagerank: number; community: number; grounded?: boolean }): AbandonmentSignal[] {
  const out: AbandonmentSignal[] = []
  if (s.community < 0 || s.degree === 0) out.push('orphaned_artifact')
  if (s.pagerank >= 0.3 && s.degree <= 2) out.push('critical_dependency_failed')  // important yet under-supported
  if (s.grounded === false) out.push('stale_evidence')
  return out
}

export const GAIA_ONTOLOGY = {
  name: 'GAIA Ontogenesis Stewardship Graph',
  ioes: 'Identity, Ontogenesis, Ecology, Stewardship',
  nodeKinds: GAIA_NODE_KINDS,
  edgeKinds: GAIA_EDGE_KINDS,
  ontogenesisPhases: ONTOGENESIS_PHASES,
  abandonmentSignals: ABANDONMENT_SIGNALS,
  dependencyTypes: DEPENDENCY_TYPES,
  invariants: GAIA_INVARIANTS,
} as const
