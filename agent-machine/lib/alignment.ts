/**
 * alignment.ts — "how does what I just read align with my brain?" When you ingest a news article / document,
 * this classifies each claim against your existing knowledge (graph atoms, doc chunks, memory, chat docs) as
 * CORROBORATED (your brain agrees), CONFLICTING (it contradicts what you know), or NOVEL (genuinely new).
 * Built on the entailment NLI (entail / contradict / neutral) so the verdict has a supporting/conflicting
 * source you can show — the demonstrable "this news agrees with X but contradicts Y" output.
 */
import { classifyEntailment, type Entailment } from './entailment.js'

export type AlignVerdict = 'corroborated' | 'conflicting' | 'novel'
export interface BrainStatement { id: string; text: string; source?: string }
export interface ClaimAlignment {
  claim: string
  verdict: AlignVerdict
  match?: { id: string; source?: string; text: string; relation: Entailment; similarity: number }
}
export interface AlignmentReport {
  claims: ClaimAlignment[]
  summary: { corroborated: number; conflicting: number; novel: number; total: number; alignmentScore: number }
}

/** Sentence-split a document into checkable claims (drops fragments + boilerplate). */
export function splitClaims(text: string, max = 40): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25 && /\s/.test(s) && /[a-z]/i.test(s))
    .slice(0, max)
}

/** Align each claim against the brain pool. Each claim takes its strongest entailment match as the verdict. */
export function alignClaims(claims: string[], brain: BrainStatement[], opts: { threshold?: number } = {}): AlignmentReport {
  const threshold = opts.threshold ?? 0.4
  const out: ClaimAlignment[] = claims.map((claim) => {
    let best: ClaimAlignment['match'] | undefined
    for (const b of brain) {
      const { relation, similarity } = classifyEntailment(b.text, claim, undefined, { threshold })
      if (relation === 'neutral') continue
      // Prefer a contradiction at equal similarity (conflicts are the high-signal finding), else the most similar.
      if (!best || similarity > best.similarity || (similarity === best.similarity && relation === 'contradict' && best.relation !== 'contradict')) {
        best = { id: b.id, source: b.source, text: b.text, relation, similarity: Number(similarity.toFixed(3)) }
      }
    }
    const verdict: AlignVerdict = !best ? 'novel' : best.relation === 'contradict' ? 'conflicting' : 'corroborated'
    return { claim, verdict, match: best }
  })
  const corroborated = out.filter((c) => c.verdict === 'corroborated').length
  const conflicting = out.filter((c) => c.verdict === 'conflicting').length
  const novel = out.filter((c) => c.verdict === 'novel').length
  const total = out.length
  // -1 (everything contradicts the brain) … +1 (everything corroborates); novel is neutral.
  const alignmentScore = total ? Number(((corroborated - conflicting) / total).toFixed(3)) : 0
  return { claims: out, summary: { corroborated, conflicting, novel, total, alignmentScore } }
}
