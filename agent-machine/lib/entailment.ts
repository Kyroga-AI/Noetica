/**
 * entailment.ts — lightweight NLI-style entailment/contradiction gate over fact pairs. A learned cross-
 * encoder (nli-deberta / Vectara HHEM) is the upgrade; this is a deterministic, model-free first layer that
 * catches the obvious cases: high lexical/semantic overlap with the SAME polarity ⇒ entail, with OPPOSITE
 * polarity (negation) ⇒ contradict. The similarity fn is injected so the embedder plugs in.
 */
export type Entailment = 'entail' | 'contradict' | 'neutral'

const NEG = /\b(not|no|never|cannot|can't|won't|doesn't|isn't|aren't|n't|without|none|fails? to|un|non)\b/i

function polarity(text: string): number {
  const matches = text.match(new RegExp(NEG, 'gi')) ?? []
  return matches.length % 2 === 0 ? 1 : -1   // even negations cancel
}

/** Token Jaccard as the default similarity (replace with embedding cosine via the sim arg). */
export function jaccard(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))
  const tb = new Set(b.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

export function classifyEntailment(
  premise: string, hypothesis: string,
  sim: (a: string, b: string) => number = jaccard,
  opts: { threshold?: number } = {},
): { relation: Entailment; similarity: number } {
  const threshold = opts.threshold ?? 0.4
  const s = sim(premise, hypothesis)
  if (s < threshold) return { relation: 'neutral', similarity: s }
  const samePolarity = polarity(premise) === polarity(hypothesis)
  return { relation: samePolarity ? 'entail' : 'contradict', similarity: s }
}
