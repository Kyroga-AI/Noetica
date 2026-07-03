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
  let fd: number | undefined
  try {
    // Open once; fstat + read from the SAME descriptor — no stat-then-read TOCTOU race.
    fd = fs.openSync(POLICY_PATH, 'r')
    const stat = fs.fstatSync(fd)
    if (policyCache && policyCache.mtimeMs === stat.mtimeMs) return policyCache.policy
    const policy = JSON.parse(fs.readFileSync(fd, 'utf8')) as EngagementPolicy
    policyCache = { mtimeMs: stat.mtimeMs, policy }
    return policy
  } catch {
    policyCache = { mtimeMs: 0, policy: null }
    return null
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd) } catch { /* */ } }
  }
}

/** May this data leave the device, per the active scope-d EngagementPolicy? */
export function checkEgress(req: ScopedEgressRequest): ScopedEgressVerdict {
  // Local performs no network egress — always allowed, no policy needed.
  if (req.tier === 'local' || req.provider === 'ollama') {
    return { allow: true, reason: 'local route — no egress', source: 'not-configured' }
  }
  // No policy configured: FAIL-CLOSED for the sovereign/armed lane (#30) — uncensored/sovereign-only work
  // must NOT egress to a third-party cloud without an explicit engagement policy authorizing it. Ordinary
  // (non-sovereign) requests preserve the prior allow so default cloud chat keeps working.
  if (!scopedConfigured()) {
    if (req.securityArmed === true || (req.sensitivityTags ?? []).includes('sovereign-only')) {
      return { allow: false, reason: 'sovereign/armed egress requires an explicit scope-d policy — staying local', downgradeTo: 'local', source: 'fail-closed' }
    }
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

export type ActionClass =
  | 'read' | 'synthetic_event' | 'dry_run' | 'network_call'
  | 'write' | 'deployment' | 'destructive_action'
  | 'credential_access' | 'memory_write' | 'identity_write'

/**
 * Which level of the principal hierarchy authorized (or denied) this action.
 * Maps the OpenAI/Anthropic Model Spec chain-of-command onto Noetica's governance stack:
 *   root      → kill-switch / hardcoded exclusions — cannot be overridden by any principal
 *   system    → scope-d EngagementPolicy (platform-level operator control)
 *   developer → operator config / system prompt context (no scope-d policy configured)
 *   user      → user instruction overrides within operator-set bounds
 *   guideline → assistant defaults (read-only / synthetic_event — no policy needed)
 */
export type AuthorityLevel = 'root' | 'system' | 'developer' | 'user' | 'guideline'

/**
 * Result of the five-point broadly-safe pre-dispatch check.
 * Each flag is true when the check PASSES (safe to proceed on that dimension).
 * A false flag is advisory — it stamps the receipt for audit but does not block by default.
 */
export interface BroadlySafeResult {
  reversible: boolean          // action can be undone (no permanent side-effects)
  minimalFootprint: boolean    // does not accumulate new permissions or capabilities
  boundedScope: boolean        // affects only the current conversation context, not third parties
  intentClear: boolean         // operator intent for this action class is unambiguous from policy
  noUserHarm: boolean          // does not actively harm the user even if operator permitted it
  all: boolean                 // true only when all five pass
}

export interface ScopedActionVerdict {
  allow: boolean
  reason: string
  source: 'scope-d' | 'not-configured' | 'fail-closed'
  authorityLevel: AuthorityLevel
  broadlySafe: BroadlySafeResult
}

/**
 * Five-point broadly-safe check — evaluates an action class against the model-spec
 * "broadly safe behaviors" prior to dispatch. Advisory only: stamps the receipt but
 * does not add blocking behavior beyond what authorizeAction already enforces.
 */
export function checkBroadlySafe(actionClass: ActionClass): BroadlySafeResult {
  const isDestructive = actionClass === 'destructive_action'
  const isNetworkCall = actionClass === 'network_call'
  const isCredential = actionClass === 'credential_access' || actionClass === 'identity_write'
  const isDeployment = actionClass === 'deployment'

  const reversible = !isDestructive && !isDeployment
  const minimalFootprint = !isCredential && !isDeployment
  const boundedScope = !isNetworkCall && !isDeployment
  // intentClear: operator intent is unambiguous for standard write/network ops (already gated
  // by scope-d policy); only credential and deployment changes require explicit authorization.
  const intentClear = !isCredential && !isDeployment
  const noUserHarm = !isDestructive && !isCredential

  const all = reversible && minimalFootprint && boundedScope && intentClear && noUserHarm
  return { reversible, minimalFootprint, boundedScope, intentClear, noUserHarm, all }
}

/**
 * Returns true when the action class is dangerous enough that auto-mode should escalate
 * to plan-mode (require user approval) before execution.
 * Targets: destructive, deployment, credential, and identity-write classes only.
 * Normal write/network/exec operations proceed in auto mode — they are already gated
 * by the autonomy ladder and scope-d policy.
 */
export function requiresPlanModeEscalation(actionClass: ActionClass): boolean {
  return actionClass === 'destructive_action'
    || actionClass === 'deployment'
    || actionClass === 'credential_access'
    || actionClass === 'identity_write'
}

/** Derive the principal authority level from a scope-d verdict source + action class. */
function deriveAuthorityLevel(source: 'scope-d' | 'not-configured' | 'fail-closed', actionClass: ActionClass): AuthorityLevel {
  if (source === 'fail-closed') return 'root'
  if (source === 'scope-d') return 'system'
  if (actionClass === 'read' || actionClass === 'synthetic_event') return 'guideline'
  return 'developer'
}

/**
 * Capability confinement (facet 4) — authorize a tool/side-effect action class
 * against the active EngagementPolicy's approvalRules. Anything beyond gate
 * 'none' has no inline approver in the mesh, so it fails closed. Read-class
 * actions are always permitted. No policy configured → unchanged (allow).
 *
 * Every verdict includes an authorityLevel (principal-hierarchy level that made
 * the decision) and a broadlySafe stamp (five-point model-spec checklist).
 */
export function authorizeAction(actionClass: ActionClass): ScopedActionVerdict {
  if (actionClass === 'read' || actionClass === 'synthetic_event') {
    return {
      allow: true,
      reason: `${actionClass} — no confinement needed`,
      source: 'not-configured',
      authorityLevel: 'guideline',
      broadlySafe: checkBroadlySafe(actionClass),
    }
  }
  if (!scopedConfigured()) {
    return {
      allow: true,
      reason: 'scope-d engagement policy not configured',
      source: 'not-configured',
      authorityLevel: 'developer',
      broadlySafe: checkBroadlySafe(actionClass),
    }
  }
  const policy = loadEngagementPolicy()
  if (!policy) {
    return {
      allow: false,
      reason: 'scope-d policy unreadable — action denied (fail-closed)',
      source: 'fail-closed',
      authorityLevel: 'root',
      broadlySafe: checkBroadlySafe(actionClass),
    }
  }
  if (policy.expiresAt && Date.parse(policy.expiresAt) <= Date.now()) {
    return {
      allow: false,
      reason: `scope-d policy ${policy.policyId} expired — action denied`,
      source: 'scope-d',
      authorityLevel: 'system',
      broadlySafe: checkBroadlySafe(actionClass),
    }
  }
  const gate = policy.approvalRules?.find((r) => r.actionClass === actionClass)?.requiredGate
  if (gate === 'none') {
    return {
      allow: true,
      reason: `scope-d: ${actionClass} authorized (gate none) under ${policy.policyId}`,
      source: 'scope-d',
      authorityLevel: 'system',
      broadlySafe: checkBroadlySafe(actionClass),
    }
  }
  const src = 'scope-d' as const
  return {
    allow: false,
    reason: `scope-d: ${actionClass} requires gate '${gate ?? 'unspecified'}' (no inline approver) under ${policy.policyId}`,
    source: src,
    authorityLevel: deriveAuthorityLevel(src, actionClass),
    broadlySafe: checkBroadlySafe(actionClass),
  }
}

/**
 * Emit a scope-d Event-IR audit record for a routing/egress decision.
 * Conforms to config/schemas/event-ir.schema.json. Fire-and-forget; never throws.
 * Optionally accepts authorityLevel and broadlySafe to stamp the principal-hierarchy
 * level and model-spec broadly-safe checklist result onto each receipt.
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
  authorityLevel?: AuthorityLevel
  broadlySafe?: BroadlySafeResult
}): void {
  // Always write the tamper-evident local audit chain — even when no scope-d policy is configured (#31), so
  // governance evidence exists by default, not only once a policy path is set.
  try {
    const observedAt = new Date().toISOString()
    const payload = {
      provider: event.provider, model: event.model, tier: event.tier,
      scope: event.scope, reason: event.reason, source: event.source, allow: event.allow,
      authorityLevel: event.authorityLevel,
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
      authorityLevel: event.authorityLevel ?? 'developer',
      broadlySafe: event.broadlySafe ?? null,
      provenance: {
        collector: 'noetica-mesh',
        hash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
      },
    }
    appendChained(record)
  } catch { /* audit is best-effort — never block a chat */ }
}

// ── Tamper-evident audit chain (#15) ────────────────────────────────────────────
// hashRecord links each event to the previous (prevHash → hash); the head is Ed25519-signed with the device
// key so the log can't be silently edited/truncated. Was built (audit-chain.ts) but never wired.
let _chainHead: string | null = null
const headPath = () => path.join(path.dirname(EVENTS_PATH), 'chain-head')
function loadHead(): string {
  if (_chainHead) return _chainHead
  try { _chainHead = fs.readFileSync(headPath(), 'utf8').trim() || undefined as never } catch { /* */ }
  return _chainHead ?? '0'.repeat(64)
}
function appendChained(record: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(EVENTS_PATH), { recursive: true })
  const { hashRecord } = require('./audit-chain.js') as typeof import('./audit-chain.js')
  const prevHash = loadHead()
  // Encrypt the record at rest, then chain the hash over the CIPHERTEXT unit `{ enc }` — so the audit trail is
  // BOTH tamper-evident (any edit to a ciphertext breaks the chain + the signed head) AND confidential (the
  // event payload isn't plaintext on disk). A verifier checks hashes of the {enc} units with no decryption;
  // reading the content decrypts with the at-rest key. NOETICA_ENCRYPT_AT_REST=0 keeps the old plaintext form
  // (and reads stay mixed-form-tolerant). Genesis/old entries that are plaintext still chain correctly.
  let unit: Record<string, unknown> = record
  try {
    if (process.env['NOETICA_ENCRYPT_AT_REST'] !== '0') {
      const { encryptLine } = require('./at-rest.js') as typeof import('./at-rest.js')
      unit = { enc: encryptLine(record) }
    }
  } catch { /* at-rest unavailable → plaintext unit, still chained */ }
  const hash = hashRecord(prevHash, unit)
  fs.appendFileSync(EVENTS_PATH, `${JSON.stringify({ ...unit, prevHash, hash })}\n`)
  _chainHead = hash
  try { fs.writeFileSync(headPath(), hash) } catch { /* */ }
  try {
    const { signHead } = require('./audit-chain.js') as typeof import('./audit-chain.js')
    const { loadOrCreateDeviceKey } = require('./audit-key.js') as typeof import('./audit-key.js')
    fs.writeFileSync(`${headPath()}.sig`, JSON.stringify({ head: hash, sig: signHead(hash, loadOrCreateDeviceKey().privateKey) }))
  } catch (e) {
    // Signing failing means the audit chain is no longer tamper-EVIDENT (anyone with file write could edit it
    // undetected). The chain itself is still written — we don't drop governance events — but a silent unsigned
    // state is a security regression, so make it LOUD + leave a breadcrumb the verifier can detect.
    console.error(`[audit-chain] SIGNING FAILED — chain head ${hash.slice(0, 12)} is UNSIGNED (tamper-evidence lost): ${(e instanceof Error ? e.message : 'unknown').replace(/[\r\n]/g, ' ')}`)
    try { fs.writeFileSync(`${headPath()}.unsigned`, JSON.stringify({ head: hash, at: new Date().toISOString(), reason: e instanceof Error ? e.message.slice(0, 200) : 'unknown' })) } catch { /* */ }
  }
}

/**
 * Verify the egress audit chain end-to-end (P3.6): re-link every entry (prevHash → hashRecord(unit)) and check
 * the Ed25519-signed head matches the device key. Tamper-evident: any edit/truncation breaks the chain or the
 * signature. Backs the Govern attestation badge. No decryption needed — hashes are over the {enc} ciphertext units.
 */
export async function verifyAuditChain(): Promise<{ entries: number; chainValid: boolean; signed: boolean; signatureValid: boolean; headHash: string; fingerprint: string; firstBreakAt?: number }> {
  const { hashRecord, verifyHead } = await import('./audit-chain.js')
  const { loadOrCreateDeviceKey, fingerprint } = await import('./audit-key.js')
  let entries = 0, chainValid = true, firstBreakAt: number | undefined
  let prev = '0'.repeat(64), last = prev
  try {
    const raw = fs.readFileSync(EVENTS_PATH, 'utf8').trim()
    if (raw) for (const line of raw.split('\n')) {
      entries++
      let obj: Record<string, unknown>
      try { obj = JSON.parse(line) as Record<string, unknown> } catch { chainValid = false; firstBreakAt ??= entries; continue }
      const { prevHash, hash, ...unit } = obj as { prevHash?: string; hash?: string }
      if (prevHash !== prev || hashRecord(String(prevHash ?? prev), unit) !== hash) { chainValid = false; firstBreakAt ??= entries }
      prev = String(hash ?? prev); last = prev
    }
  } catch { /* no log yet → empty but valid */ }
  let signed = false, signatureValid = false, fp = ''
  try {
    const sig = JSON.parse(fs.readFileSync(`${headPath()}.sig`, 'utf8')) as { head: string; sig: string }
    signed = true
    const key = loadOrCreateDeviceKey()
    fp = fingerprint(key.publicKey)
    signatureValid = sig.head === last && verifyHead(sig.head, sig.sig, key.publicKey)
  } catch { /* unsigned head */ }
  return { entries, chainValid, signed, signatureValid, headHash: last, fingerprint: fp, firstBreakAt }
}
