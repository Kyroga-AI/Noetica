/**
 * GAIA World Model integration for the user's digital twin.
 *
 * Implements the observe → synthesize → update loop using HellGraph as the
 * persistence layer and GAIA schemas as the ontology contract.
 *
 * Node labels introduced here:
 *   HumanTwin            — root node for the user's digital twin
 *   GaiaObservation      — single computer-use or sensor observation
 *   BeliefSnapshot       — LLM-synthesised belief state (posterior atoms, rules, hypotheses)
 *   CandidateLaw         — discovered behavioural pattern (sibling of PlatformDynamicsCandidate)
 *   WorldStateSnapshot   — full world state at a point in time
 *   SuperconsciousCycle  — metadata node linking a full loop run
 */

import { getGraph } from './graph.js'
import { getUserIdentity, userTwinId, userSubjectId } from './identity.js'

// ─── Constants ────────────────────────────────────────────────────────────────

// Twin / subject URNs come from the per-user identity (was hardcoded to ':michael:0001' — the source
// of every install shipping as one developer's twin). userTwinId()/userSubjectId() derive from the
// identity slug, defaulting to ':user:0001' on a fresh install until the user sets their profile.
const TWIN_LABELS = ['HumanTwin', 'GaiaEntity']

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GaiaObservationPayload {
  session_id: string
  captured_at: string
  goal?: string
  app_context?: string
  step_summary?: string
  succeeded?: boolean
  attention_tags?: string[]
  active_files?: string[]
  screen_hash?: string
}

export interface BeliefSynthesis {
  current_focus: string
  focus_confidence: number
  posterior_atoms: Array<{ claim: string; weight: number }>
  weighted_rules: Array<{ pattern: string; support: number }>
  hypotheses: Array<{ hypothesis: string; evidence: string[] }>
  candidate_laws: Array<{ law: string; trigger: string; confidence: number }>
  world_state_summary: string
}

export interface TwinState {
  twin_id: string
  subject_id: string
  last_observation_at: string | null
  last_belief_at: string | null
  last_cycle_at: string | null
  policy_status: 'active' | 'restricted' | 'revoked'
  observation_count: number
  law_count: number
}

// ─── Twin initialisation ──────────────────────────────────────────────────────

export function ensureUserTwin(): void {
  const g = getGraph()
  const twinId = userTwinId(), subjectId = userSubjectId()
  const existing = g.getNode(twinId)
  if (existing) return

  const idt = getUserIdentity()
  const now = new Date().toISOString()
  g.addNode(twinId, TWIN_LABELS, {
    subject_ref:   subjectId,
    display_name:  idt.displayName,
    email:         idt.email,
    policy_status: 'active',
    created_at:    now,
    kind:          'human_digital_twin',
  })
  g.addNode(subjectId, ['HumanSubject', 'GaiaEntity'], {
    display_name: idt.displayName,
    twin_ref:     twinId,
    created_at:   now,
  })
  g.addEdge('TWIN_OF', twinId, subjectId, { at: now })
}

// ─── Observation ingestion ────────────────────────────────────────────────────

export function ingestGaiaObservation(payload: GaiaObservationPayload): string {
  ensureUserTwin()
  const g = getGraph()
  const id = `urn:gaia:observation:${payload.session_id}:${Date.now()}`
  const now = payload.captured_at

  g.addNode(id, ['GaiaObservation', 'GaiaEntity'], {
    session_id:    payload.session_id,
    captured_at:   now,
    goal:          payload.goal          ?? '',
    app_context:   payload.app_context   ?? 'unknown',
    step_summary:  payload.step_summary  ?? '',
    succeeded:     payload.succeeded     ?? false,
    attention_tags: (payload.attention_tags ?? []).join(','),
    active_files:  (payload.active_files  ?? []).join(','),
    screen_hash:   payload.screen_hash   ?? '',
    subject_ref:   userSubjectId(),
    kind:          'computer_use_observation',
  })

  g.addEdge('OBSERVED_BY', id, userTwinId(), { at: now })
  g.addEdge('TWIN_OBSERVED', userTwinId(), id, { at: now })

  // Update twin's last_observation_at
  g.addNode(userTwinId(), TWIN_LABELS, { last_observation_at: now })

  return id
}

// ─── Read recent observations ─────────────────────────────────────────────────

export function getRecentObservations(limit = 20): Array<{ id: string; props: Record<string, unknown> }> {
  const g = getGraph()
  return g.allNodes()
    .filter((n) => n.labels.includes('GaiaObservation'))
    .sort((a, b) => {
      const at = (x: typeof a) => String(x.properties['captured_at'] ?? x.createdAt ?? '')
      return at(b).localeCompare(at(a))
    })
    .slice(0, limit)
    .map((n) => ({ id: n.id, props: n.properties }))
}

// ─── Belief snapshot write ────────────────────────────────────────────────────

export function writeBeliefSnapshot(synthesis: BeliefSynthesis, cycleId: string): string {
  const g = getGraph()
  const id = `urn:gaia:belief:${cycleId}`
  const now = new Date().toISOString()

  g.addNode(id, ['BeliefSnapshot', 'GaiaEntity'], {
    cycle_id:         cycleId,
    created_at:       now,
    current_focus:    synthesis.current_focus,
    focus_confidence: synthesis.focus_confidence,
    posterior_atoms:  JSON.stringify(synthesis.posterior_atoms),
    weighted_rules:   JSON.stringify(synthesis.weighted_rules),
    hypotheses:       JSON.stringify(synthesis.hypotheses),
    world_summary:    synthesis.world_state_summary,
    subject_ref:      userSubjectId(),
    kind:             'belief_snapshot',
  })

  g.addEdge('BELIEF_OF', id, userTwinId(), { at: now })
  g.addEdge('TWIN_BELIEVES', userTwinId(), id, { at: now })
  g.addNode(userTwinId(), TWIN_LABELS, { last_belief_at: now })

  // Write each candidate law as its own node
  for (const law of synthesis.candidate_laws) {
    const lawId = `urn:gaia:law:${cycleId}:${law.law.slice(0, 40).replace(/\s+/g, '_')}`
    g.addNode(lawId, ['CandidateLaw', 'GaiaEntity', 'PrometheusArtifact'], {
      law:        law.law,
      trigger:    law.trigger,
      confidence: law.confidence,
      cycle_id:   cycleId,
      created_at: now,
      subject_ref: userSubjectId(),
      kind:       'candidate_law',
    })
    g.addEdge('LAW_OF', lawId, userTwinId(), { at: now })
    g.addEdge('DERIVED_IN', lawId, id, { at: now })
  }

  return id
}

// ─── World state snapshot ─────────────────────────────────────────────────────

export function writeWorldStateSnapshot(summary: string, entityRefs: string[], cycleId: string): string {
  const g = getGraph()
  const id = `urn:gaia:world-state:${cycleId}`
  const now = new Date().toISOString()

  g.addNode(id, ['WorldStateSnapshot', 'GaiaEntity'], {
    cycle_id:    cycleId,
    captured_at: now,
    summary,
    entity_refs: entityRefs.join(','),
    subject_ref: userSubjectId(),
    kind:        'world_state_snapshot',
  })

  g.addEdge('WORLD_STATE_OF', id, userTwinId(), { at: now })

  return id
}

// ─── Superconscious cycle metadata ────────────────────────────────────────────

export function writeCycleNode(cycleId: string, observationIds: string[], beliefId: string, worldStateId: string): void {
  const g = getGraph()
  const now = new Date().toISOString()

  g.addNode(cycleId, ['SuperconsciousCycle', 'GaiaEntity'], {
    created_at:        now,
    observation_count: observationIds.length,
    belief_ref:        beliefId,
    world_state_ref:   worldStateId,
    subject_ref:       userSubjectId(),
    kind:              'superconscious_cycle',
  })

  g.addEdge('CYCLE_OF', cycleId, userTwinId(), { at: now })
  for (const obsId of observationIds) {
    g.addEdge('PROCESSED_OBS', cycleId, obsId, { at: now })
  }
  g.addNode(userTwinId(), TWIN_LABELS, { last_cycle_at: now })
}

// ─── Twin state read ──────────────────────────────────────────────────────────

export function getTwinState(): TwinState {
  ensureUserTwin()
  const g = getGraph()
  const twin = g.getNode(userTwinId())
  const props = twin?.properties ?? {}

  const obsCount  = g.allNodes().filter((n) => n.labels.includes('GaiaObservation')).length
  const lawCount  = g.allNodes().filter((n) => n.labels.includes('CandidateLaw')).length

  return {
    twin_id:             userTwinId(),
    subject_id:          userSubjectId(),
    last_observation_at: (props['last_observation_at'] as string) ?? null,
    last_belief_at:      (props['last_belief_at']      as string) ?? null,
    last_cycle_at:       (props['last_cycle_at']       as string) ?? null,
    policy_status:       (props['policy_status']       as TwinState['policy_status']) ?? 'active',
    observation_count:   obsCount,
    law_count:           lawCount,
  }
}

// ─── Recent beliefs & laws ────────────────────────────────────────────────────

export function getRecentBeliefs(limit = 5): Array<{ id: string; props: Record<string, unknown> }> {
  const g = getGraph()
  return g.allNodes()
    .filter((n) => n.labels.includes('BeliefSnapshot'))
    .sort((a, b) => String(b.properties['created_at'] ?? b.createdAt ?? '').localeCompare(String(a.properties['created_at'] ?? a.createdAt ?? '')))
    .slice(0, limit)
    .map((n) => ({ id: n.id, props: n.properties }))
}

export function getRecentLaws(limit = 20): Array<{ id: string; props: Record<string, unknown> }> {
  const g = getGraph()
  return g.allNodes()
    .filter((n) => n.labels.includes('CandidateLaw'))
    .sort((a, b) => String(b.properties['created_at'] ?? b.createdAt ?? '').localeCompare(String(a.properties['created_at'] ?? a.createdAt ?? '')))
    .slice(0, limit)
    .map((n) => ({ id: n.id, props: n.properties }))
}

export function getRecentWorldStates(limit = 10): Array<{ id: string; props: Record<string, unknown> }> {
  const g = getGraph()
  return g.allNodes()
    .filter((n) => n.labels.includes('WorldStateSnapshot'))
    .sort((a, b) => String(b.properties['captured_at'] ?? b.createdAt ?? '').localeCompare(String(a.properties['captured_at'] ?? a.createdAt ?? '')))
    .slice(0, limit)
    .map((n) => ({ id: n.id, props: n.properties }))
}
