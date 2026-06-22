/**
 * dp-export.ts — differential privacy at the EXPORT/sharing boundary (the one place DP belongs for an N=1
 * sovereign product: not local storage, but when an aggregate/adapter trained on personal data LEAVES the
 * device). Laplace mechanism for counts/histograms. The uniform sample u∈(0,1) is injected for determinism.
 */

/** Laplace noise with scale = sensitivity/epsilon, drawn from an injected uniform u∈(0,1). */
export function laplaceNoise(sensitivity: number, epsilon: number, u: number): number {
  const b = sensitivity / epsilon
  const uu = Math.min(0.999999, Math.max(0.000001, u)) - 0.5
  return -b * Math.sign(uu) * Math.log(1 - 2 * Math.abs(uu))
}

/** Privatize a count: add Laplace noise, clamp ≥0, round. Lower epsilon = more privacy = more noise. */
export function privatizeCount(count: number, epsilon: number, u: number): number {
  return Math.max(0, Math.round(count + laplaceNoise(1, epsilon, u)))
}

/** Privatize a histogram (sensitivity 1 per bin); noiseFn(i)→u supplies per-bin randomness. */
export function privatizeHistogram(counts: number[], epsilon: number, noiseFn: (i: number) => number): number[] {
  return counts.map((c, i) => privatizeCount(c, epsilon, noiseFn(i)))
}
