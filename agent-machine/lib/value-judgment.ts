/**
 * Value Judgment (VJ) — the 4D/RCS subsystem frontier LLMs don't have.
 *
 * In Albus's 4D/RCS reference architecture every control node runs
 * Sensory-Processing → World-Modeling → Value-Judgment → Behavior-Generation.
 * VJ scores candidate behaviors against the world model on cost / benefit / risk
 * and returns a "worth", which Behavior Generation uses to SELECT. A monolithic
 * LLM bakes value judgment into its weights; we make it an explicit, inspectable,
 * symbolic layer over the model's output — technique over horsepower.
 *
 * Here VJ scores a produced answer (a "behavior") against our world model
 * (retrieved memory context + GAIA beliefs + candidate laws):
 *   - grounding        : is the answer supported by retrieved memory?
 *   - belief_alignment : does it engage with / respect the belief & law state?
 *   - contradictions   : does it appear to contradict a promoted belief/law?
 *   - worth            : overall selection signal in [0,1]
 *
 * Deterministic and cheap (token-level heuristics) so it can run on every turn
 * and rank multiple candidates without a second model call.
 */

const STOP = new Set([
  'the','and','for','that','this','with','from','have','will','your','about','into',
  'are','was','were','what','when','where','which','would','could','should','there',
  'their','they','them','then','than','here','some','such','only','also','been','being',
  'does','done','just','like','more','most','much','many','very','over','under','because',
])

const NEGATIONS = ['not ', "n't", 'no longer', 'never', 'incorrect', 'false', 'untrue',
  'contrary to', 'contradicts', 'isn\'t', 'aren\'t', 'doesn\'t', 'cannot', 'wrong']

function contentTokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  )
}

export interface VJContradiction {
  kind: 'belief' | 'law'
  statement: string
  detail: string
}

export interface ValueJudgment {
  /** Overall selection worth in [0,1] (4D/RCS "worth"). */
  worth: number
  /** Fraction of the answer's distinctive terms supported by retrieved memory. */
  grounding: number
  /** How much the answer engages with the current belief/law state, [0,1]. */
  belief_alignment: number
  /** Potential contradictions with promoted beliefs/laws (flagged, not definitive). */
  contradictions: VJContradiction[]
  verdict: 'grounded' | 'speculative' | 'contradiction'
  notes: string[]
}

export interface VJInputs {
  answer: string
  reasoning?: string
  /** Retrieved memory context the answer should be grounded in. */
  contextText: string
  beliefs: Array<{ claim: string }>
  laws: Array<{ law: string; confidence: number }>
}

/** Detect a potential contradiction: the statement's key terms appear in the
 *  answer/reasoning AND a negation marker sits near one of them. Heuristic — we
 *  report "potential", never assert. */
function detectContradiction(statement: string, haystack: string): string | null {
  const stmtTokens = [...contentTokens(statement)]
  if (stmtTokens.length < 2) return null
  const lower = haystack.toLowerCase()
  const present = stmtTokens.filter((t) => lower.includes(t))
  if (present.length < 2) return null // not really engaging this statement
  for (const tok of present) {
    const idx = lower.indexOf(tok)
    const window = lower.slice(Math.max(0, idx - 40), idx + tok.length + 40)
    if (NEGATIONS.some((n) => window.includes(n))) {
      return `answer negates near "${tok}"`
    }
  }
  return null
}

export function judgeAnswer(input: VJInputs): ValueJudgment {
  const notes: string[] = []
  const answerTokens = contentTokens(input.answer)
  const ctxTokens = contentTokens(input.contextText)

  // Grounding: of the answer's distinctive terms, how many appear in retrieved memory.
  let grounding = 0
  if (answerTokens.size > 0 && ctxTokens.size > 0) {
    let hit = 0
    for (const t of answerTokens) if (ctxTokens.has(t)) hit++
    grounding = hit / answerTokens.size
  }

  // Belief alignment: how many belief/law statements the answer meaningfully engages.
  const statements = [
    ...input.beliefs.map((b) => ({ kind: 'belief' as const, text: b.claim })),
    ...input.laws.map((l) => ({ kind: 'law' as const, text: l.law })),
  ].filter((s) => s.text && s.text.trim().length > 0)

  const haystack = `${input.answer}\n${input.reasoning ?? ''}`
  const contradictions: VJContradiction[] = []
  let engaged = 0
  for (const s of statements) {
    const stoks = [...contentTokens(s.text)]
    if (stoks.length === 0) continue
    const overlap = stoks.filter((t) => haystack.toLowerCase().includes(t)).length
    if (overlap >= Math.max(2, Math.ceil(stoks.length * 0.3))) {
      engaged++
      const detail = detectContradiction(s.text, haystack)
      if (detail) contradictions.push({ kind: s.kind, statement: s.text, detail })
    }
  }
  const belief_alignment = statements.length > 0 ? engaged / statements.length : 0

  // Worth: grounded + belief-engaged, penalised for contradictions.
  let worth = 0.6 * grounding + 0.4 * belief_alignment
  if (contradictions.length > 0) worth = Math.max(0, worth - 0.3 * contradictions.length)
  worth = Math.max(0, Math.min(1, worth))

  let verdict: ValueJudgment['verdict']
  if (contradictions.length > 0) {
    verdict = 'contradiction'
    notes.push(`${contradictions.length} potential contradiction(s) with promoted belief/law state`)
  } else if (grounding < 0.2) {
    verdict = 'speculative'
    notes.push('answer is weakly grounded in retrieved memory — treat as speculative')
  } else {
    verdict = 'grounded'
    notes.push('answer is grounded in retrieved memory and consistent with belief state')
  }
  if (statements.length === 0) notes.push('no belief/law state available to judge against')

  return {
    worth: Number(worth.toFixed(3)),
    grounding: Number(grounding.toFixed(3)),
    belief_alignment: Number(belief_alignment.toFixed(3)),
    contradictions,
    verdict,
    notes,
  }
}
