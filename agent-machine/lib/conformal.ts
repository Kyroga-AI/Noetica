/**
 * conformal.ts — conformal abstention with a provable risk bound (DeepMind Conformal Abstention). Given a
 * calibration set of (confidence, correct) pairs, pick the lowest confidence threshold such that the error
 * rate among ACCEPTED predictions is ≤ alpha. Below threshold → abstain. For an offline product this is how
 * the abstention gate gets a guarantee instead of a guess.
 */
export interface CalibPoint { score: number; correct: boolean }

/** Lowest threshold whose accepted set has empirical error ≤ alpha; Infinity if alpha is unachievable. */
export function calibrateThreshold(calib: CalibPoint[], alpha: number): number {
  const thresholds = [...new Set(calib.map((c) => c.score))].sort((a, b) => a - b)
  for (const t of thresholds) {
    const accepted = calib.filter((c) => c.score >= t)
    if (accepted.length === 0) continue
    const err = accepted.filter((c) => !c.correct).length / accepted.length
    if (err <= alpha) return t
  }
  return Infinity
}

export function shouldAbstain(score: number, threshold: number): boolean {
  return score < threshold
}

/** Empirical coverage (fraction answered) at a threshold — the other axis of the risk-coverage tradeoff. */
export function coverageAt(calib: CalibPoint[], threshold: number): number {
  if (calib.length === 0) return 0
  return calib.filter((c) => c.score >= threshold).length / calib.length
}
