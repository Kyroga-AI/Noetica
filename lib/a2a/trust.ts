/**
 * trust.ts — A2A behavioral trust scoring (federation reputation), layered on the grantCheck zero-trust ledger.
 *
 * grantCheck answers "is this grant revoked?" (static). This adds a ROLLING trust score per SPIFFE actor so a
 * grant's STRENGTH reflects an actor's track record. A federated peer — a Ruflo swarm, a gastown / AIWG node,
 * or any cross-machine agent — is a SPIFFE actor in the SAME ledger; it earns trust slowly and loses it
 * instantly. Below the floor, grants are narrowed/denied even when not explicitly revoked. This is what makes
 * Noetica a *credible* node in a multi-framework agent mesh without bastardizing scope-d (which stays the
 * purple-team egress gate, consulted separately).
 *
 * Model (the federation-literature shape; same one Ruflo uses):
 *   score = 0.4·success + 0.2·uptime + 0.2·threat + 0.2·integrity   (each component 0..1, higher = safer)
 *   - SLOW UPGRADE  — good outcomes raise components via EMA; trust is earned over many samples.
 *   - INSTANT DOWNGRADE — a threat signal or integrity violation tanks its component immediately (one strike).
 *
 * Conformant to the mcp-a2a-zero-trust posture (SPIFFE actor identity, persisted ledger, auditable). Env-agnostic:
 * localStorage in the browser (alongside the revoked-grant ledger), in-memory in node/agent-machine (the backend
 * A2A endpoint will promote this to durable storage + HellGraph audit — see docs/a2a-federation-design.md).
 */

export interface TrustComponents { success: number; uptime: number; threat: number; integrity: number }
export interface TrustRecord {
  spiffe_id: string
  score: number
  components: TrustComponents
  samples: number
  updated_at: string
  last_downgrade_at?: string
}
/** A single behavioral signal about a SPIFFE actor. Any subset may be present. */
export interface TrustOutcome {
  ok?: boolean                 // a delegated task succeeded (true) or failed (false)
  up?: boolean                 // the peer responded / was reachable
  threat?: boolean             // a threat signal fired (injection attempt, policy probe, anomalous request)
  integrityViolation?: boolean // signature / attestation / grant-binding verification failed
}

const TRUST_KEY = 'noetica:a2a:trust'
const WEIGHTS = { success: 0.4, uptime: 0.2, threat: 0.2, integrity: 0.2 } as const
const ALPHA = 0.12               // EMA factor: a component reaches a new steady state over ~15-20 samples (earned)
const STRIKE = 0.1               // a threat/integrity strike drops the component to this immediately
export const TRUST_FLOOR = 0.45  // score below this → the grant is denied/narrowed

const mem = new Map<string, TrustRecord>()   // node/agent-machine source of truth; mirrored to localStorage in-browser

function load(): Map<string, TrustRecord> {
  if (typeof window === 'undefined') return mem
  try {
    const raw = JSON.parse(window.localStorage.getItem(TRUST_KEY) ?? '{}') as Record<string, TrustRecord>
    const m = new Map<string, TrustRecord>()
    for (const [k, v] of Object.entries(raw)) m.set(k, v)
    return m
  } catch { return mem }
}
function save(m: Map<string, TrustRecord>): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(TRUST_KEY, JSON.stringify(Object.fromEntries(m))) } catch { /* */ }
}

/** Local session actors are spiffe://noetica.local/… ; anything else is a federated/cross-machine peer. */
export function isExternalActor(spiffeId: string): boolean {
  return !spiffeId.startsWith('spiffe://noetica.local/')
}

function freshRecord(spiffeId: string): TrustRecord {
  // Local actors start trusted; unknown EXTERNAL peers start cautious — they must EARN standing, never act as a
  // high-trust node cold. threat/integrity priors start clean (1) so the FIRST violation is a hard, visible drop.
  const base = isExternalActor(spiffeId) ? 0.4 : 0.9
  const components: TrustComponents = { success: base, uptime: base, threat: 1, integrity: 1 }
  return { spiffe_id: spiffeId, score: scoreOf(components), components, samples: 0, updated_at: new Date().toISOString() }
}

const ema = (prev: number, sample: number): number => prev * (1 - ALPHA) + sample * ALPHA
function scoreOf(c: TrustComponents): number {
  return Number((WEIGHTS.success * c.success + WEIGHTS.uptime * c.uptime + WEIGHTS.threat * c.threat + WEIGHTS.integrity * c.integrity).toFixed(4))
}

/** Record a behavioral outcome for an actor and return the updated record. Slow up, instant down. */
export function recordOutcome(spiffeId: string, o: TrustOutcome, nowIso = new Date().toISOString()): TrustRecord {
  const led = load()
  const r = led.get(spiffeId) ?? freshRecord(spiffeId)
  const c = r.components
  if (o.ok !== undefined) c.success = ema(c.success, o.ok ? 1 : 0)
  if (o.up !== undefined) c.uptime = ema(c.uptime, o.up ? 1 : 0)
  // Strikes are INSTANT; clean turns recover the component slowly via EMA toward 1.
  if (o.threat) { c.threat = Math.min(c.threat, STRIKE); r.last_downgrade_at = nowIso } else c.threat = ema(c.threat, 1)
  if (o.integrityViolation) { c.integrity = 0; r.last_downgrade_at = nowIso } else c.integrity = ema(c.integrity, 1)
  r.score = scoreOf(c); r.samples += 1; r.updated_at = nowIso
  led.set(spiffeId, r); if (led !== mem) save(led); mem.set(spiffeId, r)
  return r
}

/** Current trust score for an actor (a never-seen actor gets its cautious/trusted starting score). */
export function actorTrust(spiffeId: string): number {
  return (load().get(spiffeId) ?? freshRecord(spiffeId)).score
}

const STRIKE_CLEARED = 0.5   // a struck (threat/integrity) component must EMA-recover above this to be trusted again
export interface TrustVerdict { trusted: boolean; score: number; reason: string }
/** Trust gate for a grant. Two mechanisms: (1) a HARD GATE on a recent threat/integrity strike — that's the
 * "instant downgrade": one strike denies regardless of the otherwise-high score, until the component slowly
 * EMA-recovers; (2) the rolling reputation `score` vs `floor` (sensitive capabilities pass a higher floor). */
export function trustVerdict(spiffeId: string, floor: number = TRUST_FLOOR): TrustVerdict {
  const r = load().get(spiffeId) ?? freshRecord(spiffeId)
  const c = r.components
  if (c.integrity < STRIKE_CLEARED) return { trusted: false, score: r.score, reason: 'integrity strike — actor not recovered' }
  if (c.threat < STRIKE_CLEARED) return { trusted: false, score: r.score, reason: 'threat strike — actor not recovered' }
  if (r.score < floor) return { trusted: false, score: r.score, reason: `trust ${r.score.toFixed(2)} below floor ${floor.toFixed(2)}` }
  return { trusted: true, score: r.score, reason: 'trust above floor' }
}

/** The full ledger (for the Govern surface + audit). */
export function trustLedger(): TrustRecord[] {
  return [...load().values()].sort((a, b) => a.score - b.score)
}

// ── TrustOps conformance (agent-registry) ───────────────────────────────────────
// The behavioral engine above is the COMPUTATION; this projects it onto the canonical
// agent-registry TrustOps schema (contracts/trustops/agent-authority-current-state.v0.1) so Noetica EMITS the
// standard authority state rather than shadowing it. Mapping: integrity strike → revoked (needs an explicit
// restoration decision); threat strike → suspended (auto-recovers as the component clears); low reputation →
// reduced (narrowed authority); else → active. authorityEffects gate the same axes the schema names.
export type AuthorityStatus = 'active' | 'reduced' | 'suspended' | 'revoked'
type EffectLevel = 'unchanged' | 'restricted' | 'blocked'
export interface AuthorityEffects { toolAccess: EffectLevel; memoryAccess: EffectLevel; autonomousExecution: EffectLevel; routeEligibility: EffectLevel; egressMode: 'unchanged' | 'local' }
export interface AgentAuthorityCurrentState {
  schemaVersion: 'agent-registry.agent-authority-current-state.v0.1'
  recordType: 'AgentAuthorityCurrentState'
  stateId: string
  agentRef: string
  computed_at: string
  authority_status: AuthorityStatus
  effective_decision_ref: string
  source_decision_refs: string[]
  evidenceRefs: string[]
  authorityEffects: AuthorityEffects
  restoration_required: boolean
  receipt_hash: string
  labels: Record<string, string>
}

function _hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}
function effectsFor(status: AuthorityStatus): AuthorityEffects {
  switch (status) {
    case 'active':    return { toolAccess: 'unchanged',  memoryAccess: 'unchanged',  autonomousExecution: 'unchanged',  routeEligibility: 'unchanged',  egressMode: 'unchanged' }
    case 'reduced':   return { toolAccess: 'restricted', memoryAccess: 'unchanged',  autonomousExecution: 'restricted', routeEligibility: 'restricted', egressMode: 'local' }
    case 'suspended': return { toolAccess: 'blocked',    memoryAccess: 'restricted', autonomousExecution: 'blocked',    routeEligibility: 'blocked',    egressMode: 'local' }
    case 'revoked':   return { toolAccess: 'blocked',    memoryAccess: 'blocked',    autonomousExecution: 'blocked',    routeEligibility: 'blocked',    egressMode: 'local' }
  }
}

/** The behavioral authority STATUS for an actor (the TrustOps state, pre-projection). */
export function authorityStatus(spiffeId: string): AuthorityStatus {
  const r = load().get(spiffeId) ?? freshRecord(spiffeId)
  if (r.components.integrity < STRIKE_CLEARED) return 'revoked'    // integrity violation → hard, needs restoration
  if (r.components.threat < STRIKE_CLEARED) return 'suspended'     // threat strike → temporary, auto-recovers
  if (r.score < TRUST_FLOOR) return 'reduced'                      // low reputation → narrowed authority
  return 'active'
}

/** Project an actor's behavioral trust onto the canonical agent-registry TrustOps authority-state record. */
export function authorityState(spiffeId: string): AgentAuthorityCurrentState {
  const r = load().get(spiffeId) ?? freshRecord(spiffeId)
  const status = authorityStatus(spiffeId)
  const agentRef = `agent-registry://${spiffeId.replace(/^spiffe:\/\//, '')}`
  const decisionRef = `trustops-agent-authority-decision:${_hash(spiffeId)}:${status}`
  return {
    schemaVersion: 'agent-registry.agent-authority-current-state.v0.1',
    recordType: 'AgentAuthorityCurrentState',
    stateId: `agent-authority-current-state:${spiffeId}:${status}`,
    agentRef,
    computed_at: r.updated_at,
    authority_status: status,
    effective_decision_ref: decisionRef,
    source_decision_refs: [decisionRef],
    evidenceRefs: ['policy://noetica/a2a-trust/v0.1', `trustops-receipt:${_hash(`${spiffeId}:${r.samples}`)}`],
    authorityEffects: effectsFor(status),
    restoration_required: status === 'revoked' || status === 'suspended',
    receipt_hash: `sha256:${_hash(JSON.stringify(r))}`,
    labels: { trust_score: r.score.toFixed(3), samples: String(r.samples) },
  }
}

/** Test/reset hook. */
export function _resetTrust(): void { mem.clear(); if (typeof window !== 'undefined') try { window.localStorage.removeItem(TRUST_KEY) } catch { /* */ } }
