/**
 * calibration.ts — confidence calibration + selective-prediction metrics. For a sovereign OFFLINE product,
 * an overconfident wrong answer is terminal (no cloud fallback), so the abstention threshold must be
 * CALIBRATED. Brier + ECE measure how honest the confidence is; the risk-coverage curve picks the threshold.
 */
export interface Prediction { confidence: number; correct: boolean }

/** Brier score: mean squared error of confidence vs outcome. Lower is better (0 = perfect). */
export function brier(preds: Prediction[]): number {
  if (preds.length === 0) return 0
  return preds.reduce((s, p) => s + (p.confidence - (p.correct ? 1 : 0)) ** 2, 0) / preds.length
}

/** Expected Calibration Error over equal-width confidence bins. */
export function ece(preds: Prediction[], bins = 10): number {
  if (preds.length === 0) return 0
  const buckets: Prediction[][] = Array.from({ length: bins }, () => [])
  for (const p of preds) buckets[Math.min(bins - 1, Math.floor(p.confidence * bins))]!.push(p)
  let err = 0
  for (const b of buckets) {
    if (b.length === 0) continue
    const acc = b.filter((p) => p.correct).length / b.length
    const conf = b.reduce((s, p) => s + p.confidence, 0) / b.length
    err += (b.length / preds.length) * Math.abs(acc - conf)
  }
  return err
}

/**
 * Risk-coverage curve: sort by confidence desc; at each coverage level report the error rate (risk) among
 * the answered subset. Lets you pick "answer the top X% most-confident, abstain on the rest" at a target risk.
 */
export function riskCoverage(preds: Prediction[]): Array<{ coverage: number; risk: number }> {
  const sorted = [...preds].sort((a, b) => b.confidence - a.confidence)
  const out: Array<{ coverage: number; risk: number }> = []
  let wrong = 0
  for (let i = 0; i < sorted.length; i++) {
    if (!sorted[i]!.correct) wrong++
    out.push({ coverage: (i + 1) / sorted.length, risk: wrong / (i + 1) })
  }
  return out
}
