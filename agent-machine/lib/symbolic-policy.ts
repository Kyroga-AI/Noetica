/**
 * symbolic-policy — tightens the learning loop by (1) shaping a latency-aware,
 * multi-objective reward and (2) fitting a compact, *readable* formula that maps
 * turn features → expected reward. The formula is the interpretable reward model
 * the contextual bandit optimizes against: it tells you WHICH levers move outcomes
 * (grounding, slot-fill, latency) and warm-starts arm selection so the loop
 * converges from far fewer turns than a cold context-free UCB.
 *
 * "Symbolic regression" here starts as a sparse ridge fit over engineered features
 * (a degenerate, fully-interpretable SR). The log can later feed genetic-program SR
 * for nonlinear terms; the interface (fit → formula + predict) stays the same.
 *
 * No dependencies — closed-form features + gradient-descent ridge, safe on the hot
 * path and in a metrics endpoint.
 */
import type { TurnRecord } from './dialogue-tracker.js'

// Latency budget against which slowness is penalized (demo target: a turn should
// resolve well under this). 30s — past it, the latency term saturates.
const LATENCY_BUDGET_MS = 30_000

/**
 * Multi-objective reward. Quality (VJ worth) is the base; slowness is penalized so
 * the bandit LEARNS to avoid the slow reasoner; grounding + slot-fill are rewarded
 * so the policy prefers well-grounded, fully-specified turns. Clamped to [0,1].
 */
export function computeReward(o: { worth: number; latencyMs: number; grounded: boolean; fillRate: number }): number {
  const latencyNorm = Math.min(o.latencyMs / LATENCY_BUDGET_MS, 1)
  const r = o.worth - 0.35 * latencyNorm + 0.1 * (o.grounded ? 1 : 0) + 0.05 * o.fillRate
  return Number(Math.max(0, Math.min(1, r)).toFixed(3))
}

// ── Feature engineering ─────────────────────────────────────────────────────
export const FEATURE_NAMES = ['grounded', 'fill_rate', 'latency_norm', 'intent_score', 'entity_count', 'is_reasoning', 'clarified'] as const
export type FeatureName = typeof FEATURE_NAMES[number]
export type FeatureVec = Record<FeatureName, number>

export function featuresOf(rec: TurnRecord): FeatureVec {
  return {
    grounded: rec.grounded ? 1 : 0,
    fill_rate: rec.fill_rate,
    latency_norm: Math.min(rec.latency_ms / LATENCY_BUDGET_MS, 1),
    intent_score: Math.min(rec.intent_score / 3, 1),
    entity_count: Math.min(rec.entities.length / 6, 1),
    is_reasoning: rec.capability === 'reasoning' ? 1 : 0,
    clarified: rec.clarified ? 1 : 0,
  }
}

export interface FittedPolicy {
  intercept: number
  coefficients: Record<FeatureName, number>
  formula: string
  r2: number
  n: number
  top_drivers: { feature: string; weight: number }[]
}

/**
 * Fit reward ≈ intercept + Σ wᵢ·featureᵢ via gradient-descent ridge regression on
 * standardized features (so coefficients are comparable as driver weights).
 */
export function fitPolicy(records: TurnRecord[], opts: { alpha?: number; iters?: number; lr?: number } = {}): FittedPolicy | null {
  const usable = records.filter((r) => typeof r.reward === 'number')
  if (usable.length < 8) return null // too little signal to fit honestly

  const X = usable.map((r) => featuresOf(r))
  const y = usable.map((r) => r.reward!)
  const names = FEATURE_NAMES

  // Standardize features (mean 0, sd 1) so weights are comparable.
  const mean: Record<string, number> = {}, sd: Record<string, number> = {}
  for (const f of names) {
    const col = X.map((x) => x[f])
    const m = col.reduce((a, b) => a + b, 0) / col.length
    const v = col.reduce((a, b) => a + (b - m) ** 2, 0) / col.length
    mean[f] = m; sd[f] = Math.sqrt(v) || 1
  }
  const Z = X.map((x) => names.map((f) => (x[f] - mean[f]!) / sd[f]!))
  const yMean = y.reduce((a, b) => a + b, 0) / y.length

  const alpha = opts.alpha ?? 0.1, iters = opts.iters ?? 4000, lr = opts.lr ?? 0.05
  let w = new Array(names.length).fill(0)
  let b = yMean
  for (let it = 0; it < iters; it++) {
    const gradW = new Array(names.length).fill(0)
    let gradB = 0
    for (let i = 0; i < Z.length; i++) {
      const pred = b + Z[i]!.reduce((s, z, j) => s + z * w[j]!, 0)
      const err = pred - y[i]!
      gradB += err
      for (let j = 0; j < w.length; j++) gradW[j] += err * Z[i]![j]!
    }
    b -= lr * (gradB / Z.length)
    for (let j = 0; j < w.length; j++) w[j] -= lr * (gradW[j]! / Z.length + alpha * w[j]!)
  }

  // R² on the standardized fit.
  let ssRes = 0, ssTot = 0
  for (let i = 0; i < Z.length; i++) {
    const pred = b + Z[i]!.reduce((s, z, j) => s + z * w[j]!, 0)
    ssRes += (y[i]! - pred) ** 2
    ssTot += (y[i]! - yMean) ** 2
  }
  const r2 = ssTot > 0 ? Number((1 - ssRes / ssTot).toFixed(3)) : 0

  const coefficients = Object.fromEntries(names.map((f, j) => [f, Number(w[j]!.toFixed(3))])) as Record<FeatureName, number>
  const top_drivers = names
    .map((f, j) => ({ feature: f, weight: Number(w[j]!.toFixed(3)) }))
    .sort((a, b2) => Math.abs(b2.weight) - Math.abs(a.weight)).slice(0, 4)

  const terms = names
    .map((f, j) => ({ f, w: w[j]! }))
    .filter((t) => Math.abs(t.w) >= 0.01)
    .sort((a, b2) => Math.abs(b2.w) - Math.abs(a.w))
    .map((t) => `${t.w >= 0 ? '+' : '−'}${Math.abs(t.w).toFixed(2)}·${t.f}`)
  const formula = `reward ≈ ${b.toFixed(2)} ${terms.join(' ')}`

  return { intercept: Number(b.toFixed(3)), coefficients, formula, r2, n: usable.length, top_drivers }
}

/** Predict expected reward for a feature vector using a fitted policy (unstandardized
 *  use: callers pass raw FeatureVec; we re-standardize with the stored stats embedded
 *  in coefficients is not kept, so this is a convenience that uses coefficients as-is
 *  on standardized inputs — primarily for ranking, not absolute calibration). */
export function predictReward(policy: FittedPolicy, f: FeatureVec): number {
  const raw = policy.intercept + FEATURE_NAMES.reduce((s, name) => s + (policy.coefficients[name] ?? 0) * f[name], 0)
  return Number(Math.max(0, Math.min(1, raw)).toFixed(3))
}
