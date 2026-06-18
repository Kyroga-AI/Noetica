/**
 * complexity-discipline — Moat 3, Pillar C: the np-program "Lawful Morphology
 * Doctrine" as the agent's epistemic policy.
 *
 * The np-program's real lesson isn't "solve P vs NP" — it's the discipline:
 *   • verification ≠ generation (checking can be easy where finding is hard)
 *   • every claim carries morphology (its evidence type + provenance)
 *   • lower-bound / impossibility claims require barrier analysis
 *     (relativization, natural proofs, algebrization)
 *   • confidence is calibrated and scoped — never a confident hallucinated proof
 *
 * This module classifies a task's complexity posture, picks the lawful strategy,
 * attaches barriers to hard claims, and produces a calibrated confidence + the
 * non-claim boundary that the proof fabric (Pillar B) records.
 */

export type Posture =
  | 'code'           // implementation/debugging → coder model (loads only here)
  | 'compute'        // P-like: direct computation → program-aided lane
  | 'search-verify'  // NP-like: hard to find, easy to check → generate + verify
  | 'prove'          // theorem/impossibility → proof fabric; barriers; low confidence
  | 'lookup'         // factual recall → KB retrieval
  | 'reason'         // open-ended analysis → reasoning model

export interface DisciplineVerdict {
  posture: Posture
  strategy: string
  barriers: string[]          // applicable proof barriers (if any)
  morphology: string          // evidence morphology tag
  baseConfidence: number      // before evidence adjustments
  nonClaims: string[]         // declarations for the proof artifact's non_claim_boundary
}

const BARRIERS = ['relativization', 'natural-proofs', 'algebrization']

const CODE_RE = /\b(code|function|debug|implement|refactor|compile|stack ?trace|regex|api|class|method|typescript|javascript|python|rust|golang|sql|bug in|write a (program|script|function))\b/i
const PROVE_RE = /\b(prove|proof|theorem|lemma|show that|impossible|cannot be|no algorithm|undecidable|lower bound)\b/i
const COMPUTE_RE = /\b(compute|calculate|evaluate|determinant|integral|derivative|solve for|how many|probability|what is the value|simplify)\b/i
const SEARCHVERIFY_RE = /\b(find|construct|exhibit|search|smallest|largest|optimal|satisfying|such that|counterexample)\b/i
const LOOKUP_RE = /\b(who|when|where|define|what is a|which organelle|capital of|name the)\b/i
const LOWERBOUND_RE = /\b(no (polynomial|efficient) algorithm|cannot be solved|impossible|lower bound|P\s*(!=|≠|=)\s*NP|undecidable)\b/i

/** Classify a task's complexity posture and the lawful strategy for it. */
export function classifyComplexity(question: string): DisciplineVerdict {
  const q = question.trim()
  let posture: Posture = 'reason'
  if (CODE_RE.test(q)) posture = 'code'
  else if (PROVE_RE.test(q)) posture = 'prove'
  else if (COMPUTE_RE.test(q)) posture = 'compute'
  else if (SEARCHVERIFY_RE.test(q)) posture = 'search-verify'
  else if (LOOKUP_RE.test(q)) posture = 'lookup'

  const barriers = (posture === 'prove' && LOWERBOUND_RE.test(q)) ? [...BARRIERS] : []

  const strategyMap: Record<Posture, string> = {
    code: 'Coder model: implement/debug with executable verification (the coder loads only for genuine coding context).',
    compute: 'Program-aided: derive the answer by executing a computation (catches arithmetic/algebra slips).',
    'search-verify': 'Generate candidate(s), then VERIFY each — verification is the cheap, trustworthy operation.',
    prove: 'Proof-fabric lane: structure the argument, attach barriers, and report calibrated (low) confidence — do not assert a theorem.',
    lookup: 'Knowledge-base retrieval with citation; prefer grounded recall over generation.',
    reason: 'Reasoning model with KB grounding; surface uncertainty.',
  }

  const strategy = strategyMap[posture]
  const baseConfidence = ({ code: 0.8, compute: 0.85, 'search-verify': 0.7, prove: 0.3, lookup: 0.75, reason: 0.6 } as Record<Posture, number>)[posture]

  const morphology = `posture=${posture}; evidence=${posture === 'compute' || posture === 'code' ? 'computational' : posture === 'lookup' ? 'recalled' : posture === 'prove' ? 'argumentative' : 'reasoned'}`

  const nonClaims: string[] = []
  if (posture === 'prove') {
    nonClaims.push('This is not a verified formal proof; it is a structured argument with calibrated confidence.')
    if (barriers.length) nonClaims.push(`Lower-bound/impossibility shape: subject to known barriers (${barriers.join(', ')}); not a barrier-clearing result.`)
  }
  if (posture === 'search-verify') nonClaims.push('Answer is a verified candidate, not a proof of optimality unless separately certified.')

  return { posture, strategy, barriers, morphology, baseConfidence, nonClaims }
}

/** Posture-driven model selection — the specialist coder model loads ONLY when
 *  the context is genuinely coding; compute/proof/reason/lookup use the general
 *  or reasoning model. Keeps the box from loading a 5GB coder for a math problem.
 *  Suffix is applied by the caller (e.g. "-cpu" on low-memory hosts). */
export function modelForPosture(posture: Posture): string {
  switch (posture) {
    case 'code': return 'qwen2.5-coder:7b'     // the ONLY posture that loads the coder
    case 'compute': return 'qwen2.5:7b'        // program-aided math: general model writes the python
    case 'prove': return 'deepseek-r1:8b'      // structured argument: reasoning model
    case 'reason': return 'deepseek-r1:8b'
    case 'lookup': return 'qwen2.5:7b'
    case 'search-verify': return 'qwen2.5:7b'
    default: return 'qwen2.5:7b'
  }
}

/** Adjust base confidence by available evidence: verified computation lifts it,
 *  missing grounding lowers it, applicable barriers cap it. Always scoped [0,1]. */
export function calibratedConfidence(v: DisciplineVerdict, evidence: { codeVerified?: boolean; grounded?: boolean }): number {
  let c = v.baseConfidence
  if (evidence.codeVerified) c += 0.1
  if (evidence.grounded) c += 0.05
  if (!evidence.grounded) c -= 0.05
  if (v.barriers.length) c = Math.min(c, 0.35) // hard barriers cap confidence
  return Math.max(0.05, Math.min(0.97, Number(c.toFixed(2))))
}
