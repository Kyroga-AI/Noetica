/**
 * The Critic — the verifier→selection loop that lets a small local model punch above
 * its weight. Sample N candidates, score each against the world model, SELECT the best,
 * and — the piece that was missing — emit an explicit ACCEPT / ESCALATE / CLARIFY gate.
 *
 * "Out-loop, not out-model": a 7B that samples 5 and ships only what verifies beats a 7B
 * that ships its first token. The Critic fuses the signals Noetica already computes:
 *   • Value Judgment worth (grounding + belief alignment − contradictions)  [value-judgment.ts]
 *   • Complexity posture (how verifiable the task is)                        [complexity-discipline.ts]
 *   • Self-consistency (how much the candidates agree with the winner)
 * into one selection score + a gate. The gate is the keystone: low-confidence answers
 * ESCALATE (stronger model / more samples) or CLARIFY instead of shipping as fact.
 */

import { judgeAnswer, type ValueJudgment } from './value-judgment.js'
import { classifyComplexity, type Posture } from './complexity-discipline.js'

export type CriticAction = 'accept' | 'escalate' | 'clarify'

export interface Candidate {
  content: string
  reasoning?: string
  temperature?: number
  label?: string        // e.g. model name / "esc:qwen2.5:14b" — for observability
}

export interface CriticContext {
  question: string
  /** Retrieved memory the answer should be grounded in. */
  contextText: string
  beliefs: Array<{ claim: string }>
  laws: Array<{ law: string; confidence: number }>
  graphGrounding?: number
  novelClaims?: string[]
  /** Override posture; otherwise classified from the question. */
  posture?: Posture
}

export interface ScoredCandidate {
  candidate: Candidate
  vj: ValueJudgment
  /** Fused selection score in [0,1]. */
  score: number
}

export interface CriticVerdict {
  action: CriticAction
  best: ScoredCandidate
  ranked: ScoredCandidate[]
  posture: Posture
  /** Fraction of candidates that agree with the winner (self-consistency), [0,1]. */
  agreement: number
  reason: string
}

// Posture-aware accept thresholds. Verifiable postures (facts, code, lookups) demand more
// grounding before we accept; inherently-uncertain postures (reason/prove) accept lower —
// but the answer is flagged, never asserted, by the upstream non-claims machinery.
function acceptThreshold(posture: Posture): number {
  switch (posture) {
    case 'lookup': case 'compute': case 'code': case 'search-verify': return 0.40
    case 'prove': return 0.18
    case 'reason': default: return 0.28
  }
}

const STOP = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'will', 'are', 'was', 'were', 'which', 'their', 'there'])
function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)))
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

export function scoreCandidate(c: Candidate, ctx: CriticContext): ScoredCandidate {
  const vj = judgeAnswer({
    answer: c.content, reasoning: c.reasoning, contextText: ctx.contextText,
    beliefs: ctx.beliefs, laws: ctx.laws, graphGrounding: ctx.graphGrounding, novelClaims: ctx.novelClaims,
  })
  let score = vj.worth
  if (c.content.trim().length < 8) score = 0   // empty/degenerate candidate
  return { candidate: c, vj, score: Number(score.toFixed(3)) }
}

/**
 * Critique N candidates: rank by fused score, measure self-consistency, and gate.
 * Ties (within 0.03) are broken toward the candidate most agreeing with the field
 * (consensus) — the self-consistency lever.
 */
export function critique(candidates: Candidate[], ctx: CriticContext): CriticVerdict {
  const posture = ctx.posture ?? classifyComplexity(ctx.question).posture
  const usable = candidates.filter((c) => c.content.trim().length > 0)
  const ranked = usable.map((c) => scoreCandidate(c, ctx)).sort((a, b) => b.score - a.score)

  if (ranked.length === 0) {
    const empty: ScoredCandidate = { candidate: { content: '' }, vj: judgeAnswer({ answer: '', contextText: '', beliefs: [], laws: [] }), score: 0 }
    return { action: 'escalate', best: empty, ranked: [], posture, agreement: 0, reason: 'no usable candidate produced' }
  }

  // Self-consistency: agreement of each candidate with every other (mean Jaccard),
  // used both as a confidence signal and to break near-ties toward consensus.
  const tokSets = ranked.map((r) => tokens(r.candidate.content))
  const meanAgreement = (i: number): number => {
    if (ranked.length < 2) return 1
    let s = 0
    for (let j = 0; j < ranked.length; j++) if (j !== i) s += jaccard(tokSets[i]!, tokSets[j]!)
    return s / (ranked.length - 1)
  }
  const topScore = ranked[0]!.score
  const contenders = ranked.map((r, i) => ({ i, r, agree: meanAgreement(i) })).filter((x) => topScore - x.r.score <= 0.03)
  contenders.sort((a, b) => b.agree - a.agree)
  const winner = contenders[0]!
  const best = winner.r
  const agreement = Number(winner.agree.toFixed(3))

  const th = acceptThreshold(posture)
  let action: CriticAction
  let reason: string
  if (best.vj.verdict === 'contradiction') {
    action = 'clarify'
    reason = 'winning candidate contradicts the belief/law state — clarify rather than assert'
  } else if (best.score < th) {
    action = 'escalate'
    reason = `best worth ${best.score} < accept ${th} for posture '${posture}' — escalate for a stronger answer`
  } else {
    action = 'accept'
    reason = `accepted: worth ${best.score} ≥ ${th} (posture '${posture}', agreement ${agreement})`
  }
  return { action, best, ranked, posture, agreement, reason }
}

/** Temperatures for N candidates — spread for diversity, anchored low for a precise base. */
export function bestOfTemps(n: number): number[] {
  if (n <= 1) return [0.4]
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(Number((0.2 + (0.9 - 0.2) * (i / (n - 1))).toFixed(2)))
  return out
}
