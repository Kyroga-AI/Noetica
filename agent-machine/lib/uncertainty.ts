/**
 * uncertainty.ts — semantic-entropy uncertainty + calibrated abstention ("know when you don't know").
 *
 * The grounding-verifier answers "is this SUPPORTED by the sources?". It is blind to confident parametric
 * confabulation — a fluent answer can be wrong even when phrased as if grounded. Semantic entropy (Farquhar
 * et al., Nature 2024) samples N answers, clusters them by MEANING, and measures the entropy over meaning
 * clusters: high entropy = the model is making it up. For a sovereign, OFFLINE product there is no cloud
 * fallback, so abstention is the only safety valve — this turns the uncertainty signal into an action.
 *
 * Pure + deterministic. The semantic-equivalence predicate (NLI or embedding-cosine) is injected by the
 * caller, so the embedder/entailment model plugs in at the call site while the math stays testable here.
 */

/** Greedy meaning-clustering of sampled answers under an injected equivalence predicate. */
export function semanticClusters(answers: string[], equiv: (a: string, b: string) => boolean): string[][] {
  const clusters: string[][] = []
  for (const a of answers) {
    const c = clusters.find((cl) => equiv(cl[0]!, a))
    if (c) c.push(a)
    else clusters.push([a])
  }
  return clusters
}

/** Shannon entropy (bits) over the cluster-size distribution. 0 = all answers mean the same thing. */
export function semanticEntropy(clusters: string[][]): number {
  const n = clusters.reduce((s, c) => s + c.length, 0)
  if (n === 0) return 0
  let h = 0
  for (const c of clusters) { const p = c.length / n; if (p > 0) h -= p * Math.log2(p) }
  return h
}

/** Entropy normalized to [0,1] by the maximum possible (log2 of the number of samples). */
export function normalizedEntropy(clusters: string[][]): number {
  const n = clusters.reduce((s, c) => s + c.length, 0)
  if (n <= 1) return 0
  return semanticEntropy(clusters) / Math.log2(n)
}

export type AnswerDecision = 'answer' | 'hedge' | 'abstain'

export interface ConfidenceState {
  verified: boolean      // grounding check passed?
  coverage: number       // 0..1 grounding coverage
  entropy: number        // normalized semantic entropy 0..1 (1 = total disagreement)
  agreement?: number     // 0..1 share agreeing with the chosen answer (self-consistency)
}

export interface DecisionThresholds { highEntropy?: number; lowCoverage?: number }

/**
 * Fuse grounding + uncertainty into an action:
 *   - grounded & confident          → answer
 *   - grounded but model-uncertain  → hedge ("likely, but unverified by me")
 *   - ungrounded but self-consistent→ hedge
 *   - ungrounded & high entropy     → abstain (the confabulation case — say "I don't know")
 */
export function decideAnswer(s: ConfidenceState, opts: DecisionThresholds = {}): AnswerDecision {
  const highEntropy = opts.highEntropy ?? 0.66
  const lowCoverage = opts.lowCoverage ?? 0.4
  const uncertain = s.entropy >= highEntropy
  if (!s.verified) return uncertain ? 'abstain' : 'hedge'
  if (uncertain || s.coverage < lowCoverage) return 'hedge'
  return 'answer'
}
