/**
 * logic-solver — calculate the answer by LOGIC where the question is decidable, and
 * report honestly when it is not (Gödel's remainder). The decidable fragment is
 * computed deterministically and replays (POS@T1); only the undecidable remainder
 * falls to the fenced generator — which crystallizes its result, *moving the question
 * into the decidable set next time.* The system thus expands its own decidable region.
 *
 * The order is decidability-by-cost:
 *   1. RECALL  — the question's Gödel/hash key → a crystallized, attested prior proof.
 *   2. COMPUTE — the question reduces to a closed-form operation ⇒ a CAS calculates it.
 *   3. EXTRACT — verbatim from grounded source (a read covector; cannot fabricate).
 *   4. INFER   — PLN forward-chaining over the atomspace (the graph-logic extension).
 *   5. UNDECIDABLE — not derivable in the current basis ⇒ the generator (then crystallize).
 *
 * Each step carries the meaning's prime-topic Gödel signature for provenance.
 */
import { recallArtifact } from './crystallize.js'
import { extractiveAnswer } from './extractive-qa.js'
import { lexicalSearch, documentChunkCount } from './doc-store.js'
import { matchDomains } from './graphbrain-bridge.js'
import { exponentVector, primeSignature } from './prime-topics.js'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export type SolveMethod = 'recall' | 'compute' | 'extract' | 'infer' | 'undecidable'

/** COMPUTE tier — if the question reduces to a CAS-computable operation (derivative,
 *  integral, limit, arithmetic), CALCULATE the canonical answer deterministically via
 *  cas_grade.py. Returns null when not reducible (abstains → next tier). T1, replayable. */
function computeByLaw(question: string): { answer: string; type: string } | null {
  try {
    const out = execFileSync('python3', [join(process.cwd(), 'scripts', 'cas_grade.py')], {
      input: JSON.stringify({ problem: question }), encoding: 'utf8', timeout: 15_000,
    })
    const r = JSON.parse(out) as { gradeable: boolean; canonical: string | null; type: string }
    return r.gradeable && r.canonical ? { answer: r.canonical, type: r.type } : null
  } catch { return null }
}
export interface LogicResult {
  answer: string | null
  method: SolveMethod
  decidable: boolean       // true ⇒ computed by logic (deterministic, POS@T1)
  attestation?: string     // present for recall — links to the replayable ledger
  signature?: string       // the question's prime-topic Gödel signature (base36)
}

/** The Gödel signature of a question's meaning — prime-encode its topic mixture. */
export function godelSignature(question: string): string | undefined {
  try {
    const domains = matchDomains(question, 2)
    const weights: Record<string, number> = {}
    for (const d of domains) for (const t of d.topics) weights[t.code] = (weights[t.code] ?? 0) + t.hits
    if (Object.keys(weights).length === 0) return undefined
    return primeSignature(exponentVector(weights))
  } catch { return undefined }
}

/** Try to CALCULATE the answer by logic. Returns the answer + method when decidable;
 *  method 'undecidable' (answer null) when generation is genuinely required. */
export function solveByLogic(question: string, ctx: { hasDoc?: boolean } = {}): LogicResult {
  const signature = godelSignature(question)

  // 1) RECALL — the question's key → a crystallized, attested proof. Deterministic.
  const recalled = recallArtifact(question)
  if (recalled && recalled.answer) {
    return { answer: recalled.answer, method: 'recall', decidable: true, attestation: recalled.attestation, signature }
  }

  // 2) COMPUTE — the question reduces to a closed-form operation ⇒ calculate it (CAS).
  //    This is "calculate the answer by logic": no generation, deterministic, replayable.
  const computed = computeByLaw(question)
  if (computed) {
    return { answer: `${computed.answer}   [computed: ${computed.type}]`, method: 'compute', decidable: true, signature }
  }

  // 3) EXTRACT — verbatim from a grounded source. A read covector — cannot fabricate.
  const hasDoc = ctx.hasDoc ?? documentChunkCount() > 0
  if (hasDoc) {
    const hits = lexicalSearch(question, 15)
    if (hits.length > 0) {
      const ex = extractiveAnswer(question, hits, { maxSentences: 5 })
      if (ex) return { answer: ex.answer, method: 'extract', decidable: true, signature }
    }
  }

  // 3) INFER — [extension] PLN forward-chaining over the atomspace closes more of the
  //    decidable region; it needs the question→query mapping, available but not yet
  //    wired for free-form questions. When bound, an inferred entailment is decidable.

  // 4) UNDECIDABLE in the current basis — fall to the fenced generator (which then
  //    crystallizes its answer, so the next identical question RECALLS, decidably).
  return { answer: null, method: 'undecidable', decidable: false, signature }
}
