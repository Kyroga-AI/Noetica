/**
 * debate-calibrate — fit per-detector implication strengths from labeled examples (the "learned weight"
 * of spec §2 ED-1, and the mechanism behind ED-2 self-abstention). This is the discriminative weight-
 * learning the Graph Brain synthesis calls for, reduced to its honest minimum for a deterministic
 * detector layer: a detector that fires MOSTLY on truly-fallacious text earns a high implication
 * strength; one that over-fires on clean text has its strength DECAYED toward zero — below ε_zero it
 * self-abstains (audited, no inference force).
 *
 * The estimator is per-detector PRECISION under Laplace smoothing:
 *     strength(d) = (TP + α) / (TP + FP + 2α)   scaled into [0,1]
 * where TP = fires on a fallacious example, FP = fires on a clean example. Precision (not recall) is the
 * right target because the reasoner already handles a MISSED fallacy (another detector or grounded
 * evidence covers it) but a detector that fires on clean text injects spurious negative weight — exactly
 * what a low precision score should suppress.
 *
 * HONESTY: real calibration needs a real labeled corpus with inter-annotator agreement (the spec's MQI
 * gating). This module is the MECHANISM, validated on a seed set; it is not "calibrated against
 * production labels." Feed it real labels and it produces real strengths; the seed set only proves the
 * math discriminates good detectors from noisy ones. Small-N discipline applies here too (§9 SEV-3): a
 * detector with too few labeled firings gets a WIDE-uncertainty strength, not a confident one.
 */
import { runDetectors } from './debate-detectors.js'
import { EPSILON_ZERO } from './mln.js'

export interface LabeledExample {
  text: string
  fallacious: boolean     // ground-truth label: does this text contain a real fallacy/bias?
}

export interface DetectorCalibration {
  ruleId: string
  strength: number        // fitted implication strength in [0,1] — feeds analyzeDebate's implicationStrengths
  tp: number              // fired on a fallacious example
  fp: number              // fired on a clean example (the thing to punish)
  firings: number         // total firings across the labeled set (the N for small-N discipline)
  abstains: boolean       // strength < EPSILON_ZERO → self-abstains (§2 ED-2)
  confidence: 'full' | 'limited' | 'sparse'   // how much to trust the fitted strength (small-N gate)
}

const ALPHA = 1   // Laplace smoothing: an un-fired detector gets 0.5 (max uncertainty), not 0 or 1

/** Fit implication strengths for every detector from a labeled set. Pure — same labels, same output. */
export function calibrate(examples: LabeledExample[]): Record<string, DetectorCalibration> {
  const tp = new Map<string, number>()
  const fp = new Map<string, number>()

  for (const ex of examples) {
    for (const hit of runDetectors(ex.text)) {
      const bucket = ex.fallacious ? tp : fp
      bucket.set(hit.ruleId, (bucket.get(hit.ruleId) ?? 0) + 1)
    }
  }

  const ruleIds = new Set([...tp.keys(), ...fp.keys()])
  const out: Record<string, DetectorCalibration> = {}
  for (const ruleId of ruleIds) {
    const t = tp.get(ruleId) ?? 0
    const f = fp.get(ruleId) ?? 0
    const firings = t + f
    // precision under Laplace smoothing → strength in (0,1)
    const strength = (t + ALPHA) / (t + f + 2 * ALPHA)
    out[ruleId] = {
      ruleId, strength, tp: t, fp: f, firings,
      abstains: strength < EPSILON_ZERO,
      confidence: firings >= 30 ? 'full' : firings > 10 ? 'limited' : 'sparse',
    }
  }
  return out
}

/** Project a calibration map down to the `implicationStrengths` shape analyzeDebate consumes. A
 *  'sparse'-confidence detector is passed through at its fitted strength but the caller should treat it
 *  as provisional (the reasoner's own small-N gate provides a second backstop at inference time). */
export function toImplicationStrengths(cal: Record<string, DetectorCalibration>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of Object.values(cal)) out[c.ruleId] = c.strength
  return out
}
