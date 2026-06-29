/**
 * marketing-ro-actuator — binds RecommendationObject actuation to the existing
 * autonomy admission gate (lib/governance/autonomyLadder). A marketing/SEO action
 * CANNOT take effect without an admission receipt: actuation is fail-closed.
 *
 * This reuses the canonical L0–L5 ladder rather than introducing a second policy
 * engine, and shapes the decision into the prophet-platform AutonomyAdmissionReceipt
 * (v0.1) contract so it lands on the same evidence spine as every other action.
 *
 * Contract: schemas/RecommendationObject.json in sourceos-spec.
 */
import { createHash } from 'node:crypto'
import { evaluateAutonomy, toAdmissionReceipt, type AutonomyDecision } from '../../lib/governance/autonomyLadder.js'

/** Minimal view of a RecommendationObject (see sourceos-spec RecommendationObject.json). */
export interface RecommendationObject {
  id: string
  type: 'RecommendationObject'
  specVersion: string
  scope: Record<string, unknown>
  action: { kind: string; [k: string]: unknown }
  risk: Record<string, number>
  status: 'proposed' | 'admitted' | 'actuated' | 'validated' | 'rolled-back' | 'rejected'
  autonomyLevel?: number
  admissionReceiptRef?: string | null
  evidence?: Record<string, unknown>
  [k: string]: unknown
}

/**
 * Default required autonomy level per marketing action kind. Mirrors the spirit of
 * server.ts TOOL_AUTONOMY_LEVEL: reversible content edits are L2; outward-facing,
 * hard-to-reverse actions (disavow, budget shifts) are L4.
 */
export const ACTION_AUTONOMY_LEVEL: Record<string, number> = {
  publish_static_files: 2,
  deduplicate_meta: 2,
  fix_internal_links: 2,
  adjust_exploration_entropy: 3,
  disavow_domains: 4,
  shift_budget: 4,
}

/** The marketing actuation role; its ladder ceiling bounds what can ever be granted. */
export const MARKETING_ROLE = 'operations'

export interface ActuationResult {
  admitted: boolean
  decision: AutonomyDecision
  receipt: ReturnType<typeof toAdmissionReceipt>
  ro: RecommendationObject
}

function canonicalHash(ro: RecommendationObject): string {
  // Stable hash over the RO sans volatile admission fields.
  const { admissionReceiptRef: _a, status: _s, ...rest } = ro
  const json = JSON.stringify(rest, Object.keys(rest).sort())
  return 'sha256:' + createHash('sha256').update(json).digest('hex')
}

/**
 * Evaluate the autonomy gate for a RecommendationObject and actuate only if admitted.
 *
 * @param ro                The recommendation to actuate.
 * @param availableEvidence Evidence tokens that satisfy the level's gate
 *                          (e.g. 'evidence_dossier', 'test_result_or_review_receipt').
 *                          The gate — not this function — decides if they suffice.
 * @param actuate           Side-effecting actuation, invoked ONLY on admit. Injected for testability.
 */
export async function actuateRecommendation(
  ro: RecommendationObject,
  availableEvidence: Iterable<string> = [],
  actuate: (ro: RecommendationObject) => Promise<void> | void = async () => {},
  now: () => Date = () => new Date(),
): Promise<ActuationResult> {
  const requiredLevel = ro.autonomyLevel ?? ACTION_AUTONOMY_LEVEL[ro.action.kind] ?? 4
  const decision = evaluateAutonomy(MARKETING_ROLE, `L${requiredLevel}`, availableEvidence)

  const ts = now().toISOString()
  const hash = canonicalHash(ro)
  const evidenceRefs = Object.keys(ro.evidence ?? {}).map((k) => `evidence://recommendation/${ro.id}#${k}`)
  const receipt = toAdmissionReceipt(decision, {
    receipt_id: `aar-${now().getTime()}-${ro.id}`,
    created_at: ts,
    subject_ref: ro.id,
    evidence_refs: evidenceRefs,
    hash,
  })

  // Fail-closed: only an exact 'admit' at the required level actuates.
  if (decision.decision !== 'admit') {
    return { admitted: false, decision, receipt, ro: { ...ro, status: 'rejected', admissionReceiptRef: null } }
  }

  await actuate(ro)
  return {
    admitted: true,
    decision,
    receipt,
    ro: { ...ro, status: 'actuated', admissionReceiptRef: receipt.receipt_id },
  }
}
