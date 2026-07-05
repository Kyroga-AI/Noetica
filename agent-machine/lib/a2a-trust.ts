/**
 * a2a-trust.ts — BACKEND-authoritative A2A behavioral trust + TrustOps authority state.
 *
 * The frontend lib/a2a/trust.ts holds the same algorithm for the UI, but real cross-machine federation is
 * decided HERE in the agent-machine sidecar (a remote peer talks to /api/a2a/*, not to the browser). Same model
 * as the frontend (one source of truth for the math), persisted durably + encrypted-at-rest, and projected onto
 * the canonical agent-registry TrustOps schema (contracts/trustops/agent-authority-current-state.v0.1).
 *
 *   score = 0.4·success + 0.2·uptime + 0.2·threat + 0.2·integrity   (slow up via EMA, INSTANT down on a strike)
 *   integrity strike → revoked (restoration required) · threat strike → suspended (auto-recovers) ·
 *   low reputation → reduced · else active.
 */
import { randomUUID, createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const STORE = path.join(os.homedir(), '.noetica', 'a2a-trust.json')
const WEIGHTS = { success: 0.4, uptime: 0.2, threat: 0.2, integrity: 0.2 } as const
const ALPHA = 0.12
const STRIKE = 0.1
const STRIKE_CLEARED = 0.5
export const TRUST_FLOOR = 0.45

export interface TrustComponents { success: number; uptime: number; threat: number; integrity: number }
export interface TrustRecord { spiffe_id: string; score: number; components: TrustComponents; samples: number; updated_at: string; last_downgrade_at?: string }
export interface TrustOutcome { ok?: boolean; up?: boolean; threat?: boolean; integrityViolation?: boolean }
export type AuthorityStatus = 'active' | 'reduced' | 'suspended' | 'revoked'

// Keyed by spiffeId, a remote-supplied identity → hold it in a Map, not a plain
// object, so a crafted id ("__proto__"/"constructor") can't inject onto
// Object.prototype (js/remote-property-injection). Serialize at the boundary.
let ledger: Map<string, TrustRecord> | null = null
function load(): Map<string, TrustRecord> {
  if (ledger) return ledger
  try {
    const { readJson } = require('./at-rest.js') as typeof import('./at-rest.js')
    ledger = new Map(Object.entries(readJson<Record<string, TrustRecord>>(STORE) ?? {}))
  } catch { ledger = new Map() }
  return ledger
}
function persist(): void {
  const obj = Object.fromEntries(ledger ?? new Map<string, TrustRecord>())
  try { const { writeJson } = require('./at-rest.js') as typeof import('./at-rest.js'); writeJson(STORE, obj) }
  catch { try { fs.mkdirSync(path.dirname(STORE), { recursive: true }); fs.writeFileSync(STORE, JSON.stringify(obj)) } catch { /* in-memory only */ } }
}

export function isExternalActor(spiffeId: string): boolean { return !spiffeId.startsWith('spiffe://noetica.local/') }
function fresh(spiffeId: string): TrustRecord {
  const base = isExternalActor(spiffeId) ? 0.4 : 0.9
  const components: TrustComponents = { success: base, uptime: base, threat: 1, integrity: 1 }
  return { spiffe_id: spiffeId, score: scoreOf(components), components, samples: 0, updated_at: new Date().toISOString() }
}
const ema = (p: number, s: number): number => p * (1 - ALPHA) + s * ALPHA
function scoreOf(c: TrustComponents): number {
  return Number((WEIGHTS.success * c.success + WEIGHTS.uptime * c.uptime + WEIGHTS.threat * c.threat + WEIGHTS.integrity * c.integrity).toFixed(4))
}

export function recordOutcome(spiffeId: string, o: TrustOutcome): TrustRecord {
  const led = load()
  const r = led.get(spiffeId) ?? fresh(spiffeId)
  const c = r.components
  const now = new Date().toISOString()
  if (o.ok !== undefined) c.success = ema(c.success, o.ok ? 1 : 0)
  if (o.up !== undefined) c.uptime = ema(c.uptime, o.up ? 1 : 0)
  if (o.threat) { c.threat = Math.min(c.threat, STRIKE); r.last_downgrade_at = now } else c.threat = ema(c.threat, 1)
  if (o.integrityViolation) { c.integrity = 0; r.last_downgrade_at = now } else c.integrity = ema(c.integrity, 1)
  r.score = scoreOf(c); r.samples += 1; r.updated_at = now
  led.set(spiffeId, r); persist()
  return r
}

export function authorityStatus(spiffeId: string): AuthorityStatus {
  const r = load().get(spiffeId) ?? fresh(spiffeId)
  if (r.components.integrity < STRIKE_CLEARED) return 'revoked'
  if (r.components.threat < STRIKE_CLEARED) return 'suspended'
  if (r.score < TRUST_FLOOR) return 'reduced'
  return 'active'
}

export interface GrantDecision { valid: boolean; authority_status: AuthorityStatus; trust: number; reason: string }
/** The federation gate: identity + behavioral trust → an allow/deny with the canonical authority status.
 *  `floor` lets a sensitive capability demand a higher bar. EGRESS (scope-d) is a SEPARATE, later gate. */
export function checkActorGrant(spiffeId: string, capability: string, floor: number = TRUST_FLOOR): GrantDecision {
  const r = load().get(spiffeId) ?? fresh(spiffeId)
  const status = authorityStatus(spiffeId)
  if (status === 'revoked') return { valid: false, authority_status: status, trust: r.score, reason: `${capability}: actor revoked (integrity) — restoration required` }
  if (status === 'suspended') return { valid: false, authority_status: status, trust: r.score, reason: `${capability}: actor suspended (threat) — not recovered` }
  if (r.score < floor) return { valid: false, authority_status: status, trust: r.score, reason: `${capability}: trust ${r.score.toFixed(2)} below floor ${floor.toFixed(2)}` }
  return { valid: true, authority_status: status, trust: r.score, reason: 'granted' }
}

// ── Canonical TrustOps projection (agent-registry.agent-authority-current-state.v0.1) ──
type EffectLevel = 'unchanged' | 'restricted' | 'blocked'
interface AuthorityEffects { toolAccess: EffectLevel; memoryAccess: EffectLevel; autonomousExecution: EffectLevel; routeEligibility: EffectLevel; egressMode: 'unchanged' | 'local' }
function effectsFor(s: AuthorityStatus): AuthorityEffects {
  if (s === 'active') return { toolAccess: 'unchanged', memoryAccess: 'unchanged', autonomousExecution: 'unchanged', routeEligibility: 'unchanged', egressMode: 'unchanged' }
  if (s === 'reduced') return { toolAccess: 'restricted', memoryAccess: 'unchanged', autonomousExecution: 'restricted', routeEligibility: 'restricted', egressMode: 'local' }
  if (s === 'suspended') return { toolAccess: 'blocked', memoryAccess: 'restricted', autonomousExecution: 'blocked', routeEligibility: 'blocked', egressMode: 'local' }
  return { toolAccess: 'blocked', memoryAccess: 'blocked', autonomousExecution: 'blocked', routeEligibility: 'blocked', egressMode: 'local' }
}
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

export function authorityState(spiffeId: string): Record<string, unknown> {
  const r = load().get(spiffeId) ?? fresh(spiffeId)
  const status = authorityStatus(spiffeId)
  const decisionRef = `trustops-agent-authority-decision:${sha(spiffeId).slice(0, 12)}:${status}`
  return {
    schemaVersion: 'agent-registry.agent-authority-current-state.v0.1',
    recordType: 'AgentAuthorityCurrentState',
    stateId: `agent-authority-current-state:${spiffeId}:${status}`,
    agentRef: `agent-registry://${spiffeId.replace(/^spiffe:\/\//, '')}`,
    computed_at: r.updated_at,
    authority_status: status,
    effective_decision_ref: decisionRef,
    source_decision_refs: [decisionRef],
    evidenceRefs: ['policy://noetica/a2a-trust/v0.1', `trustops-receipt:${sha(`${spiffeId}:${r.samples}`).slice(0, 16)}`],
    authorityEffects: effectsFor(status),
    restoration_required: status === 'revoked' || status === 'suspended',
    receipt_hash: `sha256:${sha(JSON.stringify(r))}`,
    labels: { trust_score: r.score.toFixed(3), samples: String(r.samples) },
  }
}

export function trustLedger(): TrustRecord[] { return [...load().values()].sort((a, b) => a.score - b.score) }
export function newGrantId(): string { return `urn:noetica:grant:a2a:${randomUUID()}` }
export function _reset(): void { ledger = new Map(); persist() }
