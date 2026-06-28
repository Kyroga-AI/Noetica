/**
 * data-onboarding.ts — the PDOR (Prophet Data On-boarding Request) object + the governed review state machine
 * for the Knowledge Commons.
 *
 * Every asset enters the Commons through a PDOR. This module decides, deterministically and conservatively, the
 * two things that protect the Commons:
 *   1. TIER — how much review the asset needs (review depth scales with license / use risk).
 *   2. BRAIN-ELIGIBILITY — the moat-safe gate: may the SOVEREIGN BRAIN learn this asset, or must it be SEGMENTED
 *      (kept queryable as attributed RAG context but never trained/baked in)?
 *
 * The governing rule: "open is a gift, licensed is a liability." Only genuinely-open, clean assets become
 * brain-eligible. Copyleft (CC-BY-SA), non-commercial / no-derivatives, pre-approved-with-terms, proprietary, OR
 * anything carrying PII/PHI/confidential/regulated content is SEGMENTED — so a license can never poison the brain
 * and every claim stays traceable to its terms. Fail-closed: an unknown license is NOT brain-eligible.
 *
 * Pure + offline. The review gate maps onto scope-d tiers (open = CITIZEN_FOG self-certify; licensed/restricted =
 * INSTITUTION review) but is self-contained here so it is fully testable.
 */

export type LicenseType =
  | 'cc0' | 'public-domain' | 'cc-by'              // OPEN + learnable
  | 'cc-by-sa' | 'cc-by-nc' | 'cc-by-nd'           // open access but copyleft / restricted reuse → segment
  | 'pre-approved' | 'proprietary' | 'unknown'     // terms-bound / closed / unknown → segment, fail-closed

export type Openness = 'open' | 'licensed' | 'restricted'
export type OnboardTier = 'candidate' | 'open' | 'licensed' | 'restricted' | 'published'
export type ReviewStatus = 'bookmarked' | 'self-certified' | 'needs-review' | 'approved' | 'declined'
export type Intent = 'register' | 'capture' | 'experiment' | 'offering'

/** Licenses the sovereign brain may legitimately LEARN from (attribution-only or freer). */
const BRAIN_OK_LICENSES = new Set<LicenseType>(['cc0', 'public-domain', 'cc-by'])

export interface PdorClassification {
  pii?: boolean
  sensitivePii?: boolean
  phi?: boolean
  confidential?: boolean
  regulated?: boolean
}

export interface Pdor {
  id: string
  requester: string
  steward?: string
  intent: Intent
  source: { name: string; provider?: string; sourceType?: string; url?: string }
  license: { type: LicenseType; termsUrl?: string; attribution?: boolean; shareAlike?: boolean }
  classification?: PdorClassification
  residency?: { location?: string; crossBorder?: boolean }
}

export interface PdorVerdict { reviewer: string; role: 'license' | 'segmentation' | 'governance'; approve: boolean; note?: string; at?: string }

export interface PdorDecision {
  tier: OnboardTier
  openness: Openness
  brainEligible: boolean      // THE moat-safe gate: learn vs segment
  segmented: boolean          // queryable RAG context only, never trained
  status: ReviewStatus
  requiresReview: boolean
  scope: 'CITIZEN_FOG' | 'CITIZEN_CLOUD' | 'INSTITUTION'
  ingestKey: string | null    // issued only once approved/self-certified
  rules: string[]             // governance rules bound to the asset
  rationale: string
}

const hasSensitive = (c?: PdorClassification): boolean =>
  !!(c && (c.pii || c.sensitivePii || c.phi || c.confidential || c.regulated))

/** Openness from license + content sensitivity (sensitivity always wins → restricted). */
export function openness(p: Pdor): Openness {
  if (hasSensitive(p.classification) || p.license.type === 'proprietary') return 'restricted'
  if (BRAIN_OK_LICENSES.has(p.license.type)) return 'open'
  return 'licensed'   // open-access-but-copyleft/NC/ND, pre-approved, or unknown (fail-closed to licensed)
}

/** THE moat-safe gate. Brain-eligible ONLY when the license is learnable AND the content is clean. Fail-closed. */
export function brainEligible(p: Pdor): boolean {
  return BRAIN_OK_LICENSES.has(p.license.type) && !hasSensitive(p.classification)
}

/** Governance rules bound to the asset, derived from license + classification. */
export function governanceRules(p: Pdor): string[] {
  const r: string[] = []
  if (!brainEligible(p)) r.push('segment-from-brain')                 // never train on it
  if (p.license.attribution || p.license.type.startsWith('cc-by')) r.push('attribute-on-use')
  if (p.license.shareAlike || p.license.type === 'cc-by-sa') r.push('share-alike')
  if (p.license.type === 'cc-by-nc') r.push('non-commercial-only')
  if (p.license.type === 'cc-by-nd') r.push('no-derivatives')
  if (hasSensitive(p.classification)) { r.push('access-control'); r.push('redact-sensitive') }
  if (p.classification?.regulated) r.push('periodic-compliance-review')
  if (p.intent === 'offering') r.push('expire-at-term')
  return r
}

function tierOf(p: Pdor, open: Openness): OnboardTier {
  if (p.intent === 'register') return 'candidate'
  if (p.intent === 'offering') return 'published'
  if (open === 'restricted') return 'restricted'
  if (open === 'licensed') return 'licensed'
  return 'open'
}

/**
 * Evaluate a PDOR into a decision. `verdicts` are the human review verdicts (ignored for self-certify tiers).
 * Open + clean → self-certified (no review, brain-eligible). Licensed/restricted/published → require ALL relevant
 * verdicts to approve. An ingest key is issued only on self-certify or full approval.
 */
export function evaluatePdor(p: Pdor, verdicts: PdorVerdict[] = []): PdorDecision {
  const open = openness(p)
  const tier = tierOf(p, open)
  const eligible = brainEligible(p)
  const rules = governanceRules(p)
  const scope: PdorDecision['scope'] = open === 'open' ? 'CITIZEN_FOG' : open === 'licensed' ? 'CITIZEN_CLOUD' : 'INSTITUTION'
  const key = () => `pdor-key-${p.id}`

  if (tier === 'candidate') {
    return { tier, openness: open, brainEligible: eligible, segmented: !eligible, status: 'bookmarked', requiresReview: false, scope, ingestKey: null, rules, rationale: 'registered as a candidate source (bookmark only — not loaded)' }
  }
  if (tier === 'open') {
    return { tier, openness: open, brainEligible: true, segmented: false, status: 'self-certified', requiresReview: false, scope, ingestKey: key(), rules, rationale: 'open license + clean content → self-certified into the sovereign brain' }
  }
  // licensed / restricted / published → require review. The relevant roles must all approve.
  const needed: PdorVerdict['role'][] = tier === 'restricted' || tier === 'published'
    ? ['license', 'segmentation', 'governance']
    : ['license', 'segmentation']
  const approvedRoles = new Set(verdicts.filter((v) => v.approve).map((v) => v.role))
  const declined = verdicts.some((v) => !v.approve)
  const allApproved = needed.every((role) => approvedRoles.has(role))

  if (declined) return { tier, openness: open, brainEligible: false, segmented: true, status: 'declined', requiresReview: true, scope, ingestKey: null, rules, rationale: 'a reviewer declined' }
  if (!allApproved) return { tier, openness: open, brainEligible: false, segmented: true, status: 'needs-review', requiresReview: true, scope, ingestKey: null, rules, rationale: `awaiting verdicts: ${needed.filter((r) => !approvedRoles.has(r)).join(', ')}` }
  return { tier, openness: open, brainEligible: false, segmented: true, status: 'approved', requiresReview: true, scope, ingestKey: key(), rules, rationale: `${tier}: all reviews approved → ingest key issued; SEGMENTED from the brain` }
}
