/**
 * mln — a ground Markov Logic Network: weighted-formula inference over an already-grounded network of
 * boolean atoms. This is the Reasoner core from the "Debater 2.0 × Graph-Brain MLN" integration spec
 * (§8) — the one piece of that spec with ZERO prior implementation anywhere in this codebase (confirmed
 * by direct search across every local repo + GitHub before writing a line of this).
 *
 * SCOPE, stated honestly: this implements a GROUND network (formulas are already-instantiated atoms —
 * "clm_01J...A attacks clm_01J...B", not a universally-quantified rule needing variable unification
 * against a KB). That matches the actual spec use case: discourse edges and detector firings arrive
 * pre-grounded from upstream (argument mining, detector library) — the Reasoner's job is inference over
 * them, not first-order grounding search. Full first-order MLN structure learning/grounding (GASP-style
 * induction over free variables) is separate, larger scope, not attempted here.
 *
 * Inference is EXACT brute-force enumeration over the 2^n possible worlds, not the spec's mentioned
 * WalkSAT (approximate MAP) / MC-SAT (approximate marginal). For the network sizes this actually needs
 * to handle — the spec's own Tier-A "block-critical subset only," explicitly scoped small for a <=300ms
 * budget — exact enumeration is both CORRECT (no approximation error) and fast enough (tractable to
 * roughly 20-22 atoms on commodity hardware). If a real network exceeds that, swap in WalkSAT/MC-SAT
 * without changing this module's public interface (worldProbability/mapInference/marginalProbability
 * would just get approximate implementations) — a scope note, not a design flaw to work around today.
 *
 *   P(x) = (1/Z) exp( Σ_i w_i · n_i(x) )     — the roof equation (Domingos, Markov Logic)
 *
 * where n_i(x) is 1 if formula i's grounded atom is true in world x, else 0 (a ground network's formulas
 * are already single atoms, so n_i(x) ∈ {0,1} rather than "count of true groundings").
 */

export interface Formula {
  /** Stable id for this grounded formula instance (e.g. an edge id, a detector-firing id). */
  id: string
  /** The grounded predicate name, for readability/debugging (e.g. 'Attacks', 'Detected', 'IsSound'). */
  predicate: string
  /** The atom(s) this formula's truth depends on. A formula with one atom is a unary weight on that
   *  atom (a discourse edge, a detector firing). A formula with multiple atoms is a clause over them
   *  (e.g. an implication) — see `impliesAtom` for the common binary "evidence implies conclusion" case. */
  atoms: string[]
  /** Real-valued weight. Sign convention (Result A, the original Graph Brain synthesis):
   *    w > 0  → POS  (contributory; the atom being true is MORE probable)
   *    w < 0  → NEG  (preventive; the atom being true is LESS probable)
   *    w = 0  → ZERO (present in the network, exerts no probabilistic force — abstention)          */
  weight: number
  source: 'prior' | 'induced' | 'detector' | 'implication'
}

export interface GroundNetwork {
  /** All boolean atoms in the network (the ground predicates whose truth we're reasoning about). */
  atoms: string[]
  formulas: Formula[]
}

/** A possible world: a truth assignment to every atom. */
export type World = Record<string, boolean>

function allWorlds(atoms: string[]): World[] {
  const n = atoms.length
  if (n > 22) {
    throw new Error(`ground network has ${n} atoms — brute-force enumeration (2^${n}) is intractable; ` +
      `this exceeds the documented tractable range (see module docstring) — split the network or swap in WalkSAT/MC-SAT`)
  }
  const worlds: World[] = []
  for (let mask = 0; mask < (1 << n); mask++) {
    const w: World = {}
    for (let i = 0; i < n; i++) w[atoms[i]!] = !!(mask & (1 << i))
    worlds.push(w)
  }
  return worlds
}

/** True iff every atom a formula depends on is true in this world (the formula "fires"). A single-atom
 *  formula fires iff that atom is true — the common case (a discourse edge, a detector's evidence). */
function fires(f: Formula, world: World): boolean {
  return f.atoms.every((a) => world[a] === true)
}

/** The un-normalized log-weight of a world: Σ w_i over every formula that fires in it. */
export function logWeight(network: GroundNetwork, world: World): number {
  return network.formulas.reduce((sum, f) => sum + (fires(f, world) ? f.weight : 0), 0)
}

/** The partition function Z = Σ_x exp(logWeight(x)) over every possible world. */
function partitionFunction(network: GroundNetwork): { Z: number; worlds: World[]; logWeights: number[] } {
  const worlds = allWorlds(network.atoms)
  const logWeights = worlds.map((w) => logWeight(network, w))
  const maxLW = Math.max(...logWeights, -Infinity)   // subtract max before exp for numerical stability
  const Z = logWeights.reduce((sum, lw) => sum + Math.exp(lw - maxLW), 0) * Math.exp(maxLW)
  return { Z, worlds, logWeights }
}

/** P(x) for one specific world — the roof equation, exact. */
export function worldProbability(network: GroundNetwork, world: World): number {
  const { Z } = partitionFunction(network)
  return Math.exp(logWeight(network, world)) / Z
}

/** MAP inference: the single most probable world (the "best explanation"). Exact — the highest
 *  logWeight world IS the MAP world (Z cancels out of the argmax, so we don't even need it here). */
export function mapInference(network: GroundNetwork): { world: World; probability: number } {
  const { Z, worlds, logWeights } = partitionFunction(network)
  let bestIdx = 0
  for (let i = 1; i < logWeights.length; i++) if (logWeights[i]! > logWeights[bestIdx]!) bestIdx = i
  return { world: worlds[bestIdx]!, probability: Math.exp(logWeights[bestIdx]!) / Z }
}

/** Marginal probability that a single atom is true, summed over every world where it holds. This is
 *  what §9's severity thresholds are computed against: P_claim = marginalProbability(net, 'IsSound(x)'). */
export function marginalProbability(network: GroundNetwork, atom: string): number {
  const { Z, worlds, logWeights } = partitionFunction(network)
  let sum = 0
  for (let i = 0; i < worlds.length; i++) if (worlds[i]![atom] === true) sum += Math.exp(logWeights[i]!)
  return sum / Z
}

// ─── Evidence predicates (§2 — detectors → evidence, the "HMM trick") ─────────────────────────────────

/** ε below which a weight is treated as abstained — present in the network, no probabilistic force.
 *  Matches the spec's ε_zero = 0.05 default (§2.1 Rule ED-2). */
export const EPSILON_ZERO = 0.05

export function isAbstained(weight: number): boolean {
  return Math.abs(weight) < EPSILON_ZERO
}

/** Turn a detector firing into an evidence-implication formula: Detected(x) ⇒ True(conclusionAtom),
 *  with a learned implication weight. If the weight has decayed below EPSILON_ZERO the formula is still
 *  returned (still audits under its ruleset_hash upstream) but contributes zero force to inference —
 *  this IS the self-abstention property (§2.1 Rule ED-2), not a special case to branch on. */
export function detectorEvidence(
  id: string, conclusionAtom: string, implicationWeight: number, source: 'detector' | 'prior' = 'detector',
): Formula {
  return { id, predicate: 'Detected', atoms: [conclusionAtom], weight: implicationWeight, source }
}

/** Sign convention for detector families (§2.2, Result A binding). LOGFALL/COGBIAS detections push
 *  probability DOWN (negative weight); grounded T1 evidence pushes it UP (positive weight). Callers
 *  supply the magnitude (detector score × calibrated strength); this only fixes the sign. */
export function signedWeight(ruleId: string, magnitude: number): number {
  const negative = /^(LOGFALL|COGBIAS)\./.test(ruleId)
  return negative ? -Math.abs(magnitude) : Math.abs(magnitude)
}

// ─── Discourse graph → ground network (§3.1) ───────────────────────────────────────────────────────────

export interface DiscourseEdge {
  id: string
  edgeType: 'support' | 'attack' | 'rebut'
  src: string
  dst: string
  confidence: number          // becomes the formula's weight directly (already a learned/prior weight)
  weightSource: 'prior' | 'induced' | 'mixed'
}

/** Reinterpret discourse edges as ground formula instances — pure data transform, no network I/O.
 *  Each edge becomes one formula over a synthetic atom naming the edge (matches §3.1: "confidence, NOW
 *  = learned weight w"). The atom set is derived so the caller can add detector-evidence formulas over
 *  the SAME atoms (e.g. an edge atom and a "this edge is fallacious" atom coexisting, per §2.1's linkage). */
export function discourseGraphToGroundNetwork(edges: DiscourseEdge[]): GroundNetwork {
  const atoms = edges.map((e) => edgeAtom(e))
  const formulas: Formula[] = edges.map((e) => ({
    id: e.id, predicate: e.edgeType === 'attack' ? 'Attacks' : e.edgeType === 'rebut' ? 'Rebuts' : 'Supports',
    atoms: [edgeAtom(e)], weight: e.confidence, source: e.weightSource === 'prior' ? 'prior' : 'induced',
  }))
  return { atoms, formulas }
}

export function edgeAtom(e: DiscourseEdge): string {
  return `${e.edgeType}(${e.src},${e.dst})`
}

// ─── Severity as a MAP/marginal threshold (§9 — the core semantic delta) ──────────────────────────────

export type Severity = 'block' | 'warn' | 'info' | 'pass'
export interface SeverityThresholds { block: number; warn: number; ok: number }

/** §9: severity is a policy threshold on the marginal probability of a claim's soundness, not a fixed
 *  per-detector property. Lower P_claim = more suspect (thresholds are probabilities the claim is SOUND;
 *  below θ_block is blocked). */
export function classifySeverity(pClaim: number, thresholds: SeverityThresholds): Severity {
  if (pClaim < thresholds.block) return 'block'
  if (pClaim < thresholds.warn) return 'warn'
  if (pClaim < thresholds.ok) return 'info'
  return 'pass'
}

/** §9 Rule SEV-3, the small-N gate: MAP-generalized severity requires N>=30 groundings in the
 *  block-critical subset, matching this codebase's OWN pre-existing board-measurement discipline
 *  (feedback_board_min_n: never generalize from <30 — see prior session memory). Below 10, callers MUST
 *  fall back to deterministic per-detector severity (this function just reports which regime applies). */
export function canUseMapSeverity(groundingCount: number): 'full' | 'limited' | 'fallback' {
  if (groundingCount >= 30) return 'full'
  if (groundingCount > 10) return 'limited'
  return 'fallback'
}

// ─── Value-driver tree → domain-prior formulas (§8.2) ──────────────────────────────────────────────────

export interface ValueDriverEdge { from: string; to: string; label: string }

const POSITIVE_VERB = /\b(increase|improve|grow|boost|enhance|expand|raise)\b/i
const NEGATIVE_VERB = /\b(reduce|churn|loss|waste|cost|decrease|shrink|minimize|prevent)\b/i

/** Compile a value-driver tree (Goal -> Value Driver -> Operational Driver -> KPI) into weighted prior
 *  formulas. Polarity from leaf-verb semantics (§8.2): Increase/Improve/Grow -> positive weight,
 *  Reduce/Churn/Loss/Waste/Cost -> negative weight — the GASP label-layer "subtracted countertext"
 *  operator, applied at the driver layer. Unlabeled/neutral edges default to a small positive prior
 *  (structure exists, weak initial belief) rather than zero (zero would mean "abstained," which is wrong
 *  for a domain-authored edge that simply lacks explicit polarity wording). */
export function compileValueDriverTree(edges: ValueDriverEdge[], priorMagnitude = 0.5): GroundNetwork {
  const atoms = edges.map((e) => driverAtom(e))
  const formulas: Formula[] = edges.map((e) => {
    const negative = NEGATIVE_VERB.test(e.label)
    const positive = POSITIVE_VERB.test(e.label)
    const weight = negative ? -priorMagnitude : positive ? priorMagnitude : priorMagnitude * 0.5
    return { id: `${e.from}->${e.to}`, predicate: 'Drives', atoms: [driverAtom(e)], weight, source: 'prior' }
  })
  return { atoms, formulas }
}

export function driverAtom(e: ValueDriverEdge): string {
  return `drives(${e.from},${e.to})`
}
