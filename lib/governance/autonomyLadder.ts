/**
 * autonomyLadder — the operator-facing surface of the AI-driven-development
 * autonomy ladder. Noetica is where a human sees and steers how autonomous the
 * choir is allowed to be; this module is the single deterministic decision the
 * Govern/Steer panel calls before promoting or demoting a level, and it shapes
 * the verdict as an AutonomyAdmissionReceipt for the evidence spine.
 *
 * The ladder is owned upstream — this mirrors the canonical contract in
 * SocioProphet/prophet-mesh (specs/ai-driven-development.yaml) and the Python
 * engine in prophet_mesh.autonomy. Keep the level/role/evidence map in sync.
 * Pure; emits no side effects.
 */

export const TRUST_KERNEL_GATE_ORDER = [
  'identity',
  'policy',
  'evidence',
  'attestation',
  'revocation',
  'audit',
] as const

export interface AutonomyLevel {
  level: string
  rank: number
  label: string
  roles: string[]
  gate: string
  evidenceRequired: string // 'none' means no gate
  enforcedAt: string
}

/** Canonical ladder (mirror of prophet-mesh specs/ai-driven-development.yaml). */
export const AUTONOMY_LADDER: AutonomyLevel[] = [
  { level: 'L0', rank: 0, label: 'manual', roles: [], gate: 'none', evidenceRequired: 'none', enforcedAt: 'noetica' },
  { level: 'L1', rank: 1, label: 'assisted', roles: ['coding', 'writing'], gate: 'surface_disclosure', evidenceRequired: 'trail_log', enforcedAt: 'noetica' },
  { level: 'L2', rank: 2, label: 'automated_unit', roles: ['coding', 'analytics'], gate: 'tests_or_review', evidenceRequired: 'test_result_or_review_receipt', enforcedAt: 'prophet-platform' },
  { level: 'L3', rank: 3, label: 'automated_design', roles: ['planning', 'research', 'analytics'], gate: 'evidence_grounded', evidenceRequired: 'evidence_dossier', enforcedAt: 'prophet-platform' },
  { level: 'L4', rank: 4, label: 'automated_solution', roles: ['conductor', 'planning', 'research', 'coding', 'writing', 'analytics', 'operations'], gate: 'channel_governed', evidenceRequired: 'conductor_response_envelope', enforcedAt: 'prophet-platform' },
  { level: 'L5', rank: 5, label: 'autonomous_governed', roles: ['conductor', 'operations', 'governance-sentinel'], gate: 'chartered_envelope', evidenceRequired: 'continuous_attestation_with_revocation', enforcedAt: 'tritfabric' },
]

const NO_EVIDENCE = new Set(['none', ''])
const byRank = new Map(AUTONOMY_LADDER.map((l) => [l.rank, l]))

export interface AutonomyDecision {
  role: string
  requestedLevel: string
  roleCeiling: string
  grantedLevel: string
  grantedLabel: string
  decision: 'admit' | 'demote' | 'deny'
  gate: string
  evidenceRequired: string
  enforcedAt: string
  demoted: boolean
  reason: string
}

function levelRank(level: string): number {
  // Floor unparseable OR negative input to L0 — a negative rank (e.g. 'L-5')
  // would otherwise produce a self-contradictory decision/receipt.
  const n = Number.parseInt(String(level).replace(/^[Ll]/, ''), 10)
  return Number.isNaN(n) || n < 0 ? 0 : n
}

/** Highest rank at which `role` is declared in the ladder (else L0). */
export function roleCeiling(role: string): number {
  let ceiling = 0
  for (const lvl of AUTONOMY_LADDER) {
    if (lvl.roles.includes(role) && lvl.rank > ceiling) ceiling = lvl.rank
  }
  return ceiling
}

function evidenceSatisfied(lvl: AutonomyLevel, available: Set<string>): boolean {
  return NO_EVIDENCE.has(lvl.evidenceRequired) || available.has(lvl.evidenceRequired)
}

/**
 * Authorize (role ceiling) then admit (evidence gate), failing closed by
 * demoting toward L0. L0 is always grantable, so a decision always exists.
 */
export function evaluateAutonomy(
  role: string,
  requestedLevel: string,
  availableEvidence: Iterable<string> = [],
): AutonomyDecision {
  const available = new Set(availableEvidence)
  const requestedRank = levelRank(requestedLevel)
  const ceiling = roleCeiling(role)
  const capped = Math.min(requestedRank, ceiling)
  const reasons: string[] = []
  if (requestedRank > ceiling) {
    reasons.push(`role '${role}' not authorized above L${ceiling}; capped from L${requestedRank}`)
  }

  let grantedRank = 0
  for (let rank = capped; rank >= 0; rank--) {
    const candidate = byRank.get(rank)
    if (!candidate) continue
    if (evidenceSatisfied(candidate, available)) {
      grantedRank = rank
      break
    }
    reasons.push(`L${rank} gate '${candidate.gate}' needs evidence '${candidate.evidenceRequired}' (absent) -> demote`)
  }

  const granted = byRank.get(grantedRank)!
  const demoted = grantedRank < requestedRank
  const decision: AutonomyDecision['decision'] =
    grantedRank === requestedRank ? 'admit' : grantedRank === 0 && requestedRank > 0 ? 'deny' : 'demote'
  if (!demoted && reasons.length === 0) reasons.push(`granted at requested level ${granted.level}`)

  return {
    role,
    requestedLevel: `L${requestedRank}`,
    roleCeiling: `L${ceiling}`,
    grantedLevel: granted.level,
    grantedLabel: granted.label,
    decision,
    gate: granted.gate,
    evidenceRequired: granted.evidenceRequired,
    enforcedAt: granted.enforcedAt,
    demoted,
    reason: reasons.join('; '),
  }
}

/**
 * Shape a decision as an AutonomyAdmissionReceipt (prophet-platform contract
 * AutonomyAdmissionReceipt.v0.1) for the evidence spine. The caller supplies
 * identifiers and the content hash; `evidence_refs` should point at the
 * artifacts that satisfied the granted level's gate.
 */
export function toAdmissionReceipt(
  d: AutonomyDecision,
  ctx: { receipt_id: string; created_at: string; subject_ref: string; evidence_refs?: string[]; hash: string; hash_algo?: string },
) {
  return {
    version: '0.1',
    receipt_id: ctx.receipt_id,
    created_at: ctx.created_at,
    service_ref: 'svc.noetica.autonomy-surface',
    role: d.role,
    requested_level: d.requestedLevel,
    granted_level: d.grantedLevel,
    role_ceiling: d.roleCeiling,
    decision: d.decision,
    gate: d.gate,
    evidence_required: d.evidenceRequired,
    evidence_refs: ctx.evidence_refs ?? [],
    reason: d.reason,
    trust_kernel_gate_order: [...TRUST_KERNEL_GATE_ORDER],
    subject_ref: ctx.subject_ref,
    policy_refs: ['prophet-mesh:specs/ai-driven-development.yaml'],
    hash: ctx.hash,
    hash_algo: ctx.hash_algo ?? 'sha256',
  }
}
