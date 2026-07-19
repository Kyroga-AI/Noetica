/**
 * debate-agent — the focused Debater agent's core loop, end to end: a claim's text → deterministic
 * detectors (lib/debate-detectors.ts) → MLN evidence → reasoner (lib/reasoner.ts) → a severity verdict
 * with an auditable rationale. This is "Debater 2.0" reframed as a FOCUSED AGENT (Deep-Research-style),
 * not a distributed system — it runs in-process, no bus/store/infra required.
 *
 * The loop is the spec's whole thesis in one function:
 *   1. detectors scan each claim → deterministic hits (score, span, rationale)   [§2 first pass, hashed]
 *   2. hits become signed evidence predicates on the claim's IsSound atom        [§2.2 sign convention]
 *   3. optional grounded evidence adds positive weight                           [§2.2 T1 grounding]
 *   4. the reasoner composes them → P(IsSound) → severity                        [§9 MAP threshold]
 *   5. the verdict carries every firing's rationale + the ruleset_hash           [audit trail]
 *
 * Because step 4 is the reasoner, all its properties hold here for free: weak detections compose,
 * grounded evidence offsets them, small-N falls back to deterministic, policy hard-blocks, self-
 * abstention. This function just wires the deterministic front end to that brain.
 */
import { runDetectors, rulesetHash, RULESET_SEMVER, type DetectorHit } from './debate-detectors.js'
import {
  reason, type ReasonerInput, type DetectorFiring, type GroundedEvidence,
  type PolicyHardConstraint, type ClaimVerdict, DEFAULT_THRESHOLDS,
} from './reasoner.js'
import type { SeverityThresholds } from './mln.js'

export interface DebateClaim {
  id: string
  text: string
}

export interface DebateInput {
  claims: DebateClaim[]
  groundedEvidence?: GroundedEvidence[]        // T1 grounded facts raising a claim's soundness
  policyConstraints?: PolicyHardConstraint[]
  thresholds?: SeverityThresholds
  /** Calibrated implication strength per detector rule (learned; §2 ED-1). Absent → 1 (raw score used).
   *  A rule mapped to <ε_zero here self-abstains (audited, no force) — the ED-2 property. */
  implicationStrengths?: Record<string, number>
}

export interface ClaimAnalysis extends ClaimVerdict {
  text: string
  hits: DetectorHit[]           // the deterministic detector rationale for this claim (audit anchor)
}

export interface DebateVerdict {
  clear: boolean
  claims: ClaimAnalysis[]
  ruleset_semver: string
  ruleset_hash: string          // the versioned identity of the detector pass that produced this (§2 ED-1)
  hcViolation?: string
}

/** Run the full detector→reason→verdict loop over a set of claims. Pure, deterministic, in-process. */
export function analyzeDebate(input: DebateInput): DebateVerdict {
  // 1+2: run detectors per claim, turn each hit into a DetectorFiring for the reasoner.
  const hitsByClaim = new Map<string, DetectorHit[]>()
  const firings: DetectorFiring[] = []
  for (const claim of input.claims) {
    const hits = runDetectors(claim.text)
    hitsByClaim.set(claim.id, hits)
    for (const h of hits) {
      firings.push({
        ruleId: h.ruleId,
        targetClaim: claim.id,
        score: h.score,
        implicationStrength: input.implicationStrengths?.[h.ruleId],
      })
    }
  }

  // 3+4: hand the composed evidence to the reasoner.
  const reasonerInput: ReasonerInput = {
    claims: input.claims.map((c) => c.id),
    detectorFirings: firings,
    groundedEvidence: input.groundedEvidence,
    policyConstraints: input.policyConstraints,
    thresholds: input.thresholds ?? DEFAULT_THRESHOLDS,
  }
  const verdict = reason(reasonerInput)
  if (verdict.hcViolation) {
    return { clear: false, claims: [], ruleset_semver: RULESET_SEMVER, ruleset_hash: rulesetHash(), hcViolation: verdict.hcViolation }
  }

  // 5: attach the deterministic rationale + text to each claim's verdict for the audit trail.
  const claims: ClaimAnalysis[] = verdict.verdicts.map((v) => ({
    ...v,
    text: input.claims.find((c) => c.id === v.claim)?.text ?? '',
    hits: hitsByClaim.get(v.claim) ?? [],
  }))

  return { clear: verdict.clear, claims, ruleset_semver: RULESET_SEMVER, ruleset_hash: rulesetHash() }
}

/** A human-readable one-line rationale for a claim analysis — the kind of thing the spec's Generation
 *  tier (§5) surfaces. Deterministic, no model call. */
export function explainClaim(a: ClaimAnalysis): string {
  const bits = a.hits.map((h) => `${h.ruleId}(${h.score.toFixed(2)})`).join(', ')
  const q = a.measurementQuality === 'fallback' ? ' [deterministic fallback: small-N]' : a.measurementQuality === 'limited' ? ' [limited-N]' : ''
  const policy = a.policyBlocked ? ' [POLICY hard-block]' : ''
  return `${a.severity.toUpperCase()} (P_sound=${a.pSound.toFixed(2)})${policy}${q} — ${bits || 'no detections'}`
}
