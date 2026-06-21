/**
 * scope-d client — gate the mesh against the SocioProphet purple-team control fabric.
 *
 * scope-d (github.com/SocioProphet/scope-d) is NOT an HTTP daemon — it is a
 * contract-first, fail-closed governance fabric. Authorization is expressed as a
 * machine-readable **EngagementPolicy** (config/schemas/engagement-policy.schema.json):
 * authority, targetBoundary, authorizedTargets/Surfaces/Modes, approvalRules,
 * blockedActions, expiresAt. The mesh consults that policy before routing, and
 * writes **Event-IR** records (config/schemas/event-ir.schema.json) as the audit.
 *
 * How routing maps onto the policy:
 *   • A LOCAL model call performs no network egress → action class `read` /
 *     `synthetic_event` (gate `none`) → always allowed. This is the sovereignty floor.
 *   • A CLOUD model call IS a `network_call` to a third-party host → gated by the
 *     policy's approvalRules + targetBoundary. In the synthetic-lab policy the cloud
 *     host is not in `authorizedTargets` and `third-party-services` is out-of-scope,
 *     so cloud egress is DENIED and the mesh routes back down to local.
 *
 * FAIL POLICY (local-first):
 *   • No policy configured (SCOPED_ENGAGEMENT_POLICY unset) → no gating; unchanged.
 *   • Policy configured but missing / unreadable / expired → FAIL CLOSED (deny egress,
 *     stay local). The local floor never depends on the daemon being healthy.
 *   • Policy present → honor it.
 *
 * Config:
 *   SCOPED_ENGAGEMENT_POLICY  path to an EngagementPolicy JSON (enables gating)
 *   SCOPED_EVENTS             path to the Event-IR JSONL audit sink
 *                             (default ~/.noetica/scope-d/events.jsonl)
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export type MeshTier = 'local' | 'sovereign-host' | 'open-provider' | 'frontier'

export interface ScopedEgressRequest {
  scope: string             // CITIZEN_FOG | CITIZEN_CLOUD | INSTITUTION | …
  policyProfile?: string
  securityArmed?: boolean
  tier: MeshTier
  provider: string          // ollama | anthropic | openai
  model: string
  target: string            // host the data would leave to (e.g. api.openai.com)
  sensitivityTags?: string[]
}

export interface ScopedEgressVerdict {
  allow: boolean
  reason: string
  downgradeTo?: 'local'
  source: 'scope-d' | 'not-configured' | 'fail-closed'
}

interface EngagementPolicy {
  policyId: string
  name: string
  targetBoundary?: { authorizedTargets?: string[]; outOfScopeTargets?: string[] }
  authorizedTargets?: string[]
  authorizedModes?: string[]
  approvalRules?: Array<{ actionClass: string; requiredGate: string }>
  blockedActions?: string[]
  expiresAt?: string
}

const POLICY_PATH = process.env['SCOPED_ENGAGEMENT_POLICY'] ?? ''
const EVENTS_PATH = process.env['SCOPED_EVENTS'] ?? path.join(os.homedir(), '.noetica', 'scope-d', 'events.jsonl')

// Categories a cloud LLM egress is treated as, for targetBoundary matching.
const CLOUD_CATEGORIES = ['third-party-services', 'public-internet', 'third_party', 'cloud']

export function scopedConfigured(): boolean {
  return POLICY_PATH.length > 0
}

let policyCache: { mtimeMs: number; policy: EngagementPolicy | null } | null = null
function loadEngagementPolicy(): EngagementPolicy | null {
  if (!scopedConfigured()) return null
  try {
    const stat = fs.statSync(POLICY_PATH)
    if (policyCache && policyCache.mtimeMs === stat.mtimeMs) return policyCache.policy
    const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8')) as EngagementPolicy
    policyCache = { mtimeMs: stat.mtimeMs, policy }
    return policy
  } catch {
    policyCache = { mtimeMs: 0, policy: null }
    return null
  }
}

/** May this data leave the device, per the active scope-d EngagementPolicy? */
export function checkEgress(req: ScopedEgressRequest): ScopedEgressVerdict {
  // Local performs no network egress — always allowed, no policy needed.
  if (req.tier === 'local' || req.provider === 'ollama') {
    return { allow: true, reason: 'local route — no egress', source: 'not-configured' }
  }
  // No policy configured → preserve prior behavior (no gating).
  if (!scopedConfigured()) {
    return { allow: true, reason: 'scope-d engagement policy not configured', source: 'not-configured' }
  }
  const policy = loadEngagementPolicy()
  if (!policy) {
    return { allow: false, reason: 'scope-d policy configured but unreadable — egress denied (fail-closed)', downgradeTo: 'local', source: 'fail-closed' }
  }
  // Expired policy → fail closed.
  if (policy.expiresAt && Date.parse(policy.expiresAt) <= Date.now()) {
    return { allow: false, reason: `scope-d policy ${policy.policyId} expired (${policy.expiresAt}) — egress denied`, downgradeTo: 'local', source: 'scope-d' }
  }
  // Target boundary: cloud host must be explicitly authorized AND not out-of-scope.
  const oos = policy.targetBoundary?.outOfScopeTargets ?? []
  if (oos.some((t) => CLOUD_CATEGORIES.includes(t) || t === req.target)) {
    return { allow: false, reason: `scope-d: ${req.target} is out-of-scope (third-party/public egress) under ${policy.policyId} — staying local`, downgradeTo: 'local', source: 'scope-d' }
  }
  const authorized = policy.authorizedTargets ?? policy.targetBoundary?.authorizedTargets ?? []
  if (authorized.length > 0 && !authorized.includes(req.target)) {
    return { allow: false, reason: `scope-d: ${req.target} not in authorizedTargets under ${policy.policyId} — staying local`, downgradeTo: 'local', source: 'scope-d' }
  }
  // network_call approval gate: anything beyond 'none' has no inline human/policy
  // approver in the mesh, so it fails closed to local.
  const gate = policy.approvalRules?.find((r) => r.actionClass === 'network_call')?.requiredGate
  if (gate && gate !== 'none') {
    return { allow: false, reason: `scope-d: network_call requires gate '${gate}' (no inline approver) under ${policy.policyId} — staying local`, downgradeTo: 'local', source: 'scope-d' }
  }
  return { allow: true, reason: `scope-d: egress to ${req.target} authorized under ${policy.policyId}`, source: 'scope-d' }
}

/**
 * Emit a scope-d Event-IR audit record for a routing/egress decision.
 * Conforms to config/schemas/event-ir.schema.json. Fire-and-forget; never throws.
 */
export function emitScopedTelemetry(event: {
  kind?: 'route' | 'egress' | string
  allow?: boolean
  provider: string
  model: string
  tier?: MeshTier
  scope: string
  reason?: string
  source?: string
}): void {
  if (!scopedConfigured()) return
  try {
    const observedAt = new Date().toISOString()
    const payload = {
      provider: event.provider, model: event.model, tier: event.tier,
      scope: event.scope, reason: event.reason, source: event.source, allow: event.allow,
    }
    const record = {
      schemaVersion: '0.1.0',
      eventId: `evt-${randomUUID()}`,
      kind: 'POLICY_DECISION',
      surface: 'ai_runtime',
      scope: { name: 'noetica-mesh', environment: 'local' },
      observedAt,
      actor: { actorType: 'agent', id: 'noetica-mesh' },
      safetyClass: event.allow === false ? 'blocked' : 'read_only',
      provenance: {
        collector: 'noetica-mesh',
        hash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
      },
    }
    fs.mkdirSync(path.dirname(EVENTS_PATH), { recursive: true })
    fs.appendFileSync(EVENTS_PATH, `${JSON.stringify(record)}\n`)
  } catch { /* audit is best-effort — never block a chat */ }
}
