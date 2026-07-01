/**
 * grounded-answer — the Phase-0.4 INLINE-BINDING contract + verifier.
 *
 * Post-hoc detection (research-verify) guesses which source supports a claim and
 * caps ~F1 0.26. Inline binding removes the guess: the generator EMITS, per span,
 * the evidence_id it used at decode time (`filename#chunkIndex`, stable from the
 * doc-store), so the pointer is the model's OUTPUT, not our reconstruction. The
 * verifier then confirms (a) the pointer RESOLVES to real evidence and (b) that
 * evidence actually ENTAILS the span. Faithful attribution = resolved ∧ entailed.
 *
 * This is the boundary a frontier RAG API cannot draw: generate-then-cite and
 * post-hoc retrieve-then-cite assign citations in a step INDEPENDENT of the
 * evidence used, so they can be *correct* but never provably *faithful*. Here the
 * citation IS the generation input.
 *
 * Brain-agnostic on purpose: the generator (any brain) emits GroundedAnswer via
 * structured output / constrained decoding; this harness verifies the binding.
 * The new brain implements the emit side against this contract.
 */
import type { EntailFn } from './research-verify.js'

/** One grounded span the generator declares, with the evidence it used. */
export interface GroundedSpan {
  text: string
  evidence_id: string            // e.g. "handbook.md#12" — resolvable in the doc-store
  relation?: 'entails' | 'supports' | 'defines' | 'computes'
}
/** The generator's structured output: prose split into spans, each cited or not. */
export interface GroundedAnswer {
  text: string
  spans: GroundedSpan[]          // spans[].text with an evidence_id are the P-RET claims
}

export type SpanTag = 'P-RET-faithful' | 'P-RET-unfaithful' | 'P-GEN'
export interface SpanVerdict {
  text: string
  evidence_id: string | null
  resolved: boolean              // did evidence_id point at real evidence?
  entailed: boolean              // did THAT evidence entail the span?
  tag: SpanTag
}
export interface InlineBindingResult {
  spans: SpanVerdict[]
  total: number
  faithful: number               // P-RET-faithful
  citedUnfaithful: number        // P-RET-unfaithful — the citation exists but the evidence doesn't support it
  generated: number              // P-GEN — no citation (honest "this is generated")
  faithfulAttributionRate: number  // faithful / (cited spans)  — the headline metric
}

/**
 * Verify inline binding: per declared span, resolve its evidence_id and check the
 * cited evidence entails it. This makes P-RET true-by-construction where it holds,
 * and exposes cited-but-unfaithful spans (the frontier's silent failure).
 */
export async function verifyInlineBinding(
  answer: GroundedAnswer,
  evidenceById: Map<string, string>,
  entail: EntailFn,
  { entailAt = 0.5 }: { entailAt?: number } = {},
): Promise<InlineBindingResult> {
  const spans: SpanVerdict[] = []
  for (const s of answer.spans) {
    if (!s.evidence_id) {
      spans.push({ text: s.text, evidence_id: null, resolved: false, entailed: false, tag: 'P-GEN' })
      continue
    }
    const ev = evidenceById.get(s.evidence_id)
    const resolved = ev != null
    const entailed = resolved ? (await entail(ev as string, s.text)) >= entailAt : false
    spans.push({
      text: s.text,
      evidence_id: s.evidence_id,
      resolved,
      entailed,
      tag: resolved && entailed ? 'P-RET-faithful' : 'P-RET-unfaithful',
    })
  }
  const cited = spans.filter((s) => s.evidence_id != null)
  const faithful = spans.filter((s) => s.tag === 'P-RET-faithful').length
  const citedUnfaithful = spans.filter((s) => s.tag === 'P-RET-unfaithful').length
  const generated = spans.filter((s) => s.tag === 'P-GEN').length
  return {
    spans,
    total: spans.length,
    faithful,
    citedUnfaithful,
    generated,
    faithfulAttributionRate: cited.length ? faithful / cited.length : 0,
  }
}
