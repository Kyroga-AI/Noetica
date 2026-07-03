/**
 * isolation-policy.ts — the twin's SKIN: classify by data-sensitivity, route to the right compute
 * tier (local / edge / cloud), and bind a memory namespace to a trust tier. Fail-closed: unknown data
 * is treated as HIGH sensitivity and kept on-device (Noetica is sovereign/local-first by default).
 *
 * The one policy every organ calls — Memory (which namespace to write), Perception (may this ingest
 * leave the device), Action (where may this task run). Realizes the sensitivity→local/edge/cloud
 * diagram + the namespace/enclave isolation from the agentic-self architecture.
 */

import { createHash } from 'node:crypto'

export type Sensitivity = 'high' | 'medium' | 'low'
export type ComputeTier = 'local' | 'edge' | 'cloud'
export type TrustNamespace = 'self' | 'workspace' | 'collective'

export interface TaskDescriptor {
  content?: string
  labels?: string[]              // e.g. ['pii','secret','public','internal']
  requestedTier?: ComputeTier    // caller preference — honored only if within the allowed ceiling
  namespace?: TrustNamespace     // explicit trust scope; else derived from sensitivity
}

export interface IsolationDecision {
  sensitivity: Sensitivity
  tier: ComputeTier              // the allowed CEILING (offload util picks within [local..tier] by cost)
  allowedTiers: ComputeTier[]
  namespace: TrustNamespace      // memory scope to read/write under
  egressAllowed: boolean         // may bytes leave the device (i.e. cloud reachable)?
  conflict: boolean              // a request/namespace was down-clamped for leakage prevention
  reason: string
}

const TIER_RANK: Record<ComputeTier, number> = { local: 0, edge: 1, cloud: 2 }
const RANK_TIER: ComputeTier[] = ['local', 'edge', 'cloud']

// sensitivity caps the ceiling; namespace caps it further; the more restrictive wins.
const SENS_CEIL: Record<Sensitivity, ComputeTier> = { high: 'local', medium: 'edge', low: 'cloud' }
const NS_CEIL: Record<TrustNamespace, ComputeTier> = { self: 'local', workspace: 'edge', collective: 'cloud' }
const SENS_NS: Record<Sensitivity, TrustNamespace> = { high: 'self', medium: 'workspace', low: 'collective' }

const HIGH_LABELS = /^(secret|credential|key|token|password|pii|phi|private|health|financial)$/i
const MED_LABELS = /^(internal|workspace|confidential|restricted)$/i
const LOW_LABELS = /^(public|open|published|shareable)$/i

// content that must never egress even if mislabeled (leakage prevention overrides an optimistic label)
const SECRET_CONTENT = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sk|pk|ghp|xox[baprs])[-_][A-Za-z0-9]{16,}\b/,   // api tokens
  /\bAKIA[0-9A-Z]{16}\b/,                               // aws access key
  /\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b/,                     // ssn-shaped
]

/** Sensitivity = the MOST restrictive of label-derived and content-derived; unknown ⇒ high (fail-closed). */
export function classifySensitivity(task: TaskDescriptor): Sensitivity {
  const labels = task.labels ?? []
  let bySens: Sensitivity | null = null
  if (labels.some((l) => HIGH_LABELS.test(l))) bySens = 'high'
  else if (labels.some((l) => MED_LABELS.test(l))) bySens = 'medium'
  else if (labels.some((l) => LOW_LABELS.test(l))) bySens = 'low'

  const contentSecret = !!task.content && SECRET_CONTENT.some((re) => re.test(task.content!))
  if (contentSecret) return 'high'                 // leakage prevention: content wins over a rosy label
  if (bySens) return bySens
  return 'high'                                     // unknown ⇒ fail-closed on-device
}

export function decideIsolation(task: TaskDescriptor): IsolationDecision {
  const sensitivity = classifySensitivity(task)
  const ns: TrustNamespace = task.namespace ?? SENS_NS[sensitivity]

  // ceiling = most restrictive of sensitivity + namespace
  const ceilRank = Math.min(TIER_RANK[SENS_CEIL[sensitivity]], TIER_RANK[NS_CEIL[ns]])
  let tierRank = ceilRank
  let conflict = false
  const notes: string[] = [`${sensitivity}-sensitivity in ${ns} → ≤${RANK_TIER[ceilRank]}`]

  if (task.requestedTier) {
    const reqRank = TIER_RANK[task.requestedTier]
    if (reqRank > ceilRank) { conflict = true; notes.push(`requested ${task.requestedTier} DENIED (leakage prevention)`) }
    tierRank = Math.min(reqRank, ceilRank)
  }
  const mislabeledSecret = !!task.content && (task.labels ?? []).some((l) => LOW_LABELS.test(l)) && sensitivity === 'high'
  if (mislabeledSecret) { conflict = true; notes.push('secret content under a public label — clamped local') }

  const tier = RANK_TIER[tierRank]
  const allowedTiers = RANK_TIER.slice(0, ceilRank + 1)
  return {
    sensitivity,
    tier,
    allowedTiers,
    namespace: ns,
    egressAllowed: allowedTiers.includes('cloud'),
    conflict,
    reason: notes.join('; '),
  }
}

/** The fs-memory-store namespace to scope this task's memory under (Self stays on-device). */
export function memoryNamespaceFor(d: IsolationDecision): TrustNamespace { return d.namespace }

// ── Conform to the canonical membrane (SocioProphet/slash-topics Membrane_Decision_v0.2) ──
// This local classifier does NOT own policy authority — it emits a MembraneDecision that the
// slash-topics/agentplane membrane consumes + enforces (WallGuard does cross-agent admission).
export type MembraneVerdict = 'ALLOW' | 'DENY' | 'QUARANTINE' | 'REDACT' | 'REQUIRE_SIGNATURE'
export type MembraneScope = 'user_local' | 'global_platform'
export interface MembraneDecision {
  decision: MembraneVerdict
  audit: { policy_ref: string; ts: string; reasons: string[]; redactions?: string[]; required_signers?: string[] }
  model_family: 'lsa' | 'lsi' | 'lda'
  scope: MembraneScope
  artifacts?: { input_hash?: string; output_hash?: string; receipt_ref?: string }
}

const POLICY_ID = 'noetica/isolation-policy@0.1.0'
const sha256 = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex')

/** Emit a slash-topics-conformant MembraneDecision from an isolation decision. My 3 trust namespaces
 * collapse to their 2 scopes (self+workspace → user_local; collective → global_platform). */
export function toMembraneDecision(d: IsolationDecision, opts: { input?: string; modelFamily?: 'lsa' | 'lsi' | 'lda' } = {}): MembraneDecision {
  const scope: MembraneScope = d.namespace === 'collective' ? 'global_platform' : 'user_local'
  const decision: MembraneVerdict = d.conflict ? 'DENY' : 'ALLOW' // QUARANTINE/REDACT/REQUIRE_SIGNATURE owned by the full membrane
  return {
    decision,
    scope,
    model_family: opts.modelFamily ?? 'lsa',
    audit: { policy_ref: sha256(`${POLICY_ID}|${d.sensitivity}|${d.namespace}|${d.tier}`), ts: new Date().toISOString(), reasons: d.reason.split('; ').filter(Boolean) },
    ...(opts.input ? { artifacts: { input_hash: sha256(opts.input) } } : {}),
  }
}
