/**
 * semantic-probe.ts — cheap uncertainty proxies (Semantic Entropy Probes role). Full semantic entropy needs
 * N samples; these are near-free proxies: the spread of sampled answer scores, and answer stability (share of
 * samples in the modal meaning-cluster). High spread / low stability ⇒ the model is unsure.
 */
export function scoreSpread(scores: number[]): { mean: number; std: number; uncertain: boolean } {
  if (scores.length === 0) return { mean: 0, std: 0, uncertain: true }
  const mean = scores.reduce((s, x) => s + x, 0) / scores.length
  const std = Math.sqrt(scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length)
  return { mean: Number(mean.toFixed(4)), std: Number(std.toFixed(4)), uncertain: std >= 0.25 }
}

/** Answer stability = fraction of samples in the largest meaning-cluster (1 = unanimous, low = scattered). */
export function answerStability(samples: string[], equiv: (a: string, b: string) => boolean = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()): number {
  if (samples.length === 0) return 0
  const clusters: string[][] = []
  for (const s of samples) { const c = clusters.find((cl) => equiv(cl[0]!, s)); if (c) c.push(s); else clusters.push([s]) }
  return Math.max(...clusters.map((c) => c.length)) / samples.length
}
