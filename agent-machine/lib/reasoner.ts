/**
 * reasoner — the Reasoner *pipeline* that composes the ground-MLN core (lib/mln.ts) into the decision
 * flow the "Debater 2.0 × Graph-Brain MLN Integration Layer" spec describes: detector firings + discourse
 * edges + an optional domain value-driver prior are fused into ONE ground network, and a claim's severity
 * (block/warn/info/pass) is read off the marginal probability that the claim is sound (§9) — NOT off any
 * single detector's fixed severity.
 *
 * This is pure logic: no event bus, no persistent store, no network I/O. It's the runnable core a real
 * Reasoner *service* would wrap (see reasoner-bus.ts for the mock-bus service shell). Everything the spec
 * bolts on around it — Kafka topics, Neo4j persistence, K8s, mTLS, the Tier-B async pool — is deployment
 * plumbing, deliberately absent here (documented in the mln.ts commit + memory).
 *
 * The key modeling reduction (faithful to §2 + §9's composition rule): a claim gets one boolean atom
 * IsSound(claim). Every detector firing against that claim contributes a SIGNED weight to that atom
 * (LOGFALL/COGBIAS negative, grounded evidence positive — §2.2). Because they all weight the same atom,
 * they SUM — so "three sub-θ_warn detections jointly cross θ_block" (§9 Rule SEV-1) is automatic, and
 * "one detector can't nuke a well-grounded claim" (contradiction tolerance) is automatic too: a strong
 * positive grounding weight offsets a negative detection rather than being overridden.
 */
import {
  type GroundNetwork, type Formula, type Severity, type SeverityThresholds,
  marginalProbability, mapInference, classifySeverity, canUseMapSeverity,
  signedWeight, isAbstained,
} from './mln.js'

export interface DetectorFiring {
  ruleId: string          // e.g. 'LOGFALL.STRAWMAN.V2' — sign comes from the family (§2.2)
  targetClaim: string     // the claim id this firing bears on
  score: number           // deterministic detector score in [0,1] (UNCHANGED from the base detector)
  implicationStrength?: number   // learned/calibrated multiplier on the score (default 1); decay→0 self-abstains
}

export interface GroundedEvidence {
  targetClaim: string
  weight: number          // positive weight raising IsSound(claim); e.g. a T1 grounded fact (§2.2)
  evidenceId: string
}

export interface PolicyHardConstraint {
  claim: string           // a claim under a hard POLICY.* constraint → block-critical (§5) regardless of P
  reason: string
}

export interface ReasonerInput {
  claims: string[]
  detectorFirings: DetectorFiring[]
  groundedEvidence?: GroundedEvidence[]
  policyConstraints?: PolicyHardConstraint[]
  thresholds?: SeverityThresholds
}

export const DEFAULT_THRESHOLDS: SeverityThresholds = { block: 0.3, warn: 0.55, ok: 0.8 }

const soundAtom = (claim: string): string => `IsSound(${claim})`

export interface ClaimVerdict {
  claim: string
  pSound: number                       // marginal P(IsSound(claim)) — the number §9 thresholds against
  severity: Severity
  measurementQuality: 'full' | 'limited' | 'fallback'   // §9 Rule SEV-3 small-N gate
  contributingFirings: number          // how many detector firings bore on this claim (the "N" for the gate)
  policyBlocked: boolean               // a hard POLICY.* constraint forces block regardless of pSound (§5)
  abstainedFirings: string[]           // rule_ids whose weight decayed below ε_zero — audited, no force (§2 ED-2)
}

export interface ReasonerVerdict {
  clear: boolean                       // conform to the existing scope-d/action-cell verdict shape
  verdicts: ClaimVerdict[]
  hcViolation?: string                 // §3.2 Rule DG-2: network wasn't a valid Gibbs distribution
}

/** Build the per-claim ground network for one claim: all firings + grounded evidence weighting its
 *  IsSound atom. Kept per-claim (not one giant network) because claims are conditionally independent
 *  given their own evidence here — which also keeps every network trivially inside the tractable atom
 *  ceiling, the block-critical-subset discipline of §5 made structural. */
function claimNetwork(claim: string, input: ReasonerInput): { net: GroundNetwork; firingCount: number; abstained: string[] } {
  const atom = soundAtom(claim)
  const formulas: Formula[] = []
  const abstained: string[] = []
  let firingCount = 0

  for (const f of input.detectorFirings) {
    if (f.targetClaim !== claim) continue
    firingCount++
    const magnitude = f.score * (f.implicationStrength ?? 1)
    const w = signedWeight(f.ruleId, magnitude)
    if (isAbstained(w)) { abstained.push(f.ruleId); continue }   // §2 ED-2: still counted, exerts no force
    formulas.push({ id: `${f.ruleId}@${claim}`, predicate: 'Detected', atoms: [atom], weight: w, source: 'detector' })
  }
  for (const e of input.groundedEvidence ?? []) {
    if (e.targetClaim !== claim) continue
    const w = Math.abs(e.weight)   // grounded evidence is positive by convention (§2.2)
    if (isAbstained(w)) continue
    formulas.push({ id: e.evidenceId, predicate: 'Grounded', atoms: [atom], weight: w, source: 'implication' })
  }
  return { net: { atoms: [atom], formulas }, firingCount, abstained }
}

/** §3.2 Rule DG-2 (Hammersley–Clifford validity): a strictly-positive Gibbs distribution requires finite
 *  weights (no unintended ±∞). Non-finite weights → HC_VIOLATION, reject before inference. */
function hcValidate(input: ReasonerInput): string | null {
  for (const f of input.detectorFirings) {
    const w = f.score * (f.implicationStrength ?? 1)
    if (!Number.isFinite(w)) return `HC_VIOLATION: non-finite weight from firing ${f.ruleId}@${f.targetClaim}`
  }
  for (const e of input.groundedEvidence ?? []) {
    if (!Number.isFinite(e.weight)) return `HC_VIOLATION: non-finite weight from evidence ${e.evidenceId}`
  }
  return null
}

/** The full Tier-A synchronous reasoning pass (§5): for each claim, compose evidence, run exact MAP/
 *  marginal over its (small, block-critical) network, and classify severity — with the small-N gate
 *  falling back to deterministic worst-detector severity below N≤10 (§9 Rule SEV-3). */
export function reason(input: ReasonerInput): ReasonerVerdict {
  const hc = hcValidate(input)
  if (hc) return { clear: false, verdicts: [], hcViolation: hc }

  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS
  const policyClaims = new Set((input.policyConstraints ?? []).map((p) => p.claim))
  const verdicts: ClaimVerdict[] = []

  for (const claim of input.claims) {
    const { net, firingCount, abstained } = claimNetwork(claim, input)
    const pSound = marginalProbability(net, soundAtom(claim))
    const quality = canUseMapSeverity(firingCount)
    const policyBlocked = policyClaims.has(claim)

    let severity: Severity
    if (policyBlocked) {
      severity = 'block'                                  // §5: a hard POLICY constraint blocks regardless of P
    } else if (quality === 'fallback') {
      // §9 Rule SEV-3: below N≤10, do NOT issue a MAP-generalized severity — fall back to the deterministic
      // worst single detector (the original per-detector behavior). This is the anti-clustering-illusion gasket.
      severity = deterministicFallbackSeverity(claim, input, thresholds)
    } else {
      severity = classifySeverity(pSound, thresholds)     // full or limited: MAP-based, limited is stamped as such
    }

    verdicts.push({ claim, pSound, severity, measurementQuality: quality, contributingFirings: firingCount, policyBlocked, abstainedFirings: abstained })
  }

  // clear = no claim is blocked (the verdict is fail-closed: a single block fails the whole set, matching
  // scope-d's fail-closed posture).
  const clear = !verdicts.some((v) => v.severity === 'block')
  return { clear, verdicts }
}

/** §9 Rule SEV-3 fallback: with too few groundings to trust MAP composition, map the single strongest
 *  (highest-score) detection to a fixed severity band — the deterministic, per-detector original behavior. */
function deterministicFallbackSeverity(claim: string, input: ReasonerInput, thresholds: SeverityThresholds): Severity {
  const firings = input.detectorFirings.filter((f) => f.targetClaim === claim)
  if (firings.length === 0) return 'pass'
  const worst = Math.max(...firings.map((f) => f.score))
  // map a raw detector score to a severity band conservatively: high score = low soundness.
  const pSoundEquiv = 1 - worst
  return classifySeverity(pSoundEquiv, thresholds)
}

/** Convenience: the MAP world for a claim (which atoms are most-probably true) — exposed for the
 *  rationale/proof-trace the spec's Generation tier (§5) would surface. */
export function claimMapWorld(claim: string, input: ReasonerInput): { pSound: number; sound: boolean } {
  const { net } = claimNetwork(claim, input)
  const { world } = mapInference(net)
  return { pSound: marginalProbability(net, soundAtom(claim)), sound: world[soundAtom(claim)] === true }
}

// ─── §6: counter-tests as Reasoner/prover operations (routing table) ──────────────────────────────────
// The CTEST library is UNCHANGED (§6); this only declares which counter-tests are Reasoner queries vs.
// standalone classifiers, and whether they gate synchronously (Tier-A, block-critical) or async (Tier-B).
// A real system routes on this table; here it's the auditable, testable declaration of that routing.

export type CtestEngine = 'reasoner' | 'classifier'
export type CtestTier = 'A' | 'B'
export interface CtestRoute { engine: CtestEngine; operation: string; tier: CtestTier }

export const CTEST_ROUTING: Record<string, CtestRoute> = {
  'CTEST.CAUSAL.DO/COUNTERFACTUAL.V1': { engine: 'reasoner', operation: 'do-calculus MAP with edge intervened', tier: 'B' },
  'CTEST.PRESUP.EXPOSE.V1':            { engine: 'reasoner', operation: 'implicit-proposition extraction → surface hidden formula', tier: 'B' },
  'CTEST.TERMS.LOCK.V1':              { engine: 'reasoner', operation: 'SameRecord transitivity guard (identity-collapse block)', tier: 'A' },
  'CTEST.ACYCLIC.PROOF.V1':          { engine: 'reasoner', operation: 'proof-tree acyclicity (Gish-gallop = never composes)', tier: 'A' },
  'CTEST.CHAIN.PROB.V1':             { engine: 'reasoner', operation: 'marginal of multi-hop causal path (product of edge weights)', tier: 'B' },
  'CTEST.EVIDENCE-LR.V1':            { engine: 'reasoner', operation: 'likelihood ratio = exp(Δ weighted-log-prob)', tier: 'B' },
}

/** Where does a counter-test run? Table lookup, defaulting anything not listed to the standalone
 *  Counter-Test Runner classifier (§6 Rule CT-1: "remaining CTEST.* run as-is"). */
export function routeCtest(ctestId: string): CtestRoute {
  return CTEST_ROUTING[ctestId] ?? { engine: 'classifier', operation: 'standalone counter-test runner', tier: 'B' }
}
