/** Tests for detector calibration (lib/debate-calibrate.ts): fitted strengths must reward precise
 *  detectors and decay noisy ones, using a seed labeled set that proves the MATH discriminates (not a
 *  claim of production calibration). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calibrate, toImplicationStrengths, type LabeledExample } from './debate-calibrate.js'

// seed labeled set: strawman/ad-hominem examples labeled fallacious; clean statements labeled not.
const SEED: LabeledExample[] = [
  { text: "So you're saying we should never regulate anything at all?", fallacious: true },
  { text: "So you're saying everyone must always agree with the experts?", fallacious: true },
  { text: "You're just an idiot who doesn't understand economics.", fallacious: true },
  { text: "You're a typical shill, of course you'd say that.", fallacious: true },
  { text: 'The measured output was 3.2 MW under calibrated load (2021 report).', fallacious: false },
  { text: 'Based on the study, the effect appears likely, pending more data.', fallacious: false },
  { text: 'The reaction proceeds via an SN2 mechanism at the primary carbon.', fallacious: false },
]

test('a precise detector (strawman, fires only on fallacious seeds) earns high strength', () => {
  const cal = calibrate(SEED)
  const strawman = cal['LOGFALL.STRAWMAN.V1']
  assert.ok(strawman, 'strawman detector should have fired on the seed set')
  assert.ok(strawman!.strength > 0.6, `expected high strength, got ${strawman!.strength}`)
  assert.equal(strawman!.fp, 0, 'strawman should not have fired on any clean example')
})

test('a detector that only fires on fallacious examples has fp=0 and does not abstain', () => {
  const cal = calibrate(SEED)
  const adhom = cal['LOGFALL.ADHOMINEM.V1']
  assert.ok(adhom)
  assert.equal(adhom!.fp, 0)
  assert.ok(!adhom!.abstains)
})

test('a synthetic noisy detector (fires equally on clean + fallacious) gets a strength near 0.5', () => {
  // simulate a noisy detector by labeling: build a set where one rule fires on both classes evenly.
  // We use APPEALAUTHORITY which fires on "experts say" — put it in BOTH a fallacious and a clean-cited
  // example so its precision is diluted.
  const mixed: LabeledExample[] = [
    { text: 'Experts say this is settled, no citation.', fallacious: true },
    { text: 'Experts say this is settled (Smith et al. 2021, doi:10.1/x).', fallacious: false },
  ]
  const cal = calibrate(mixed)
  const auth = cal['LOGFALL.APPEALAUTHORITY.V1']
  assert.ok(auth)
  // 1 TP, 1 FP → precision (1+1)/(1+1+2) = 0.5 exactly under Laplace smoothing
  assert.ok(Math.abs(auth!.strength - 0.5) < 1e-9, `expected ~0.5, got ${auth!.strength}`)
})

test('confidence reflects the small-N discipline (sparse below 11 firings)', () => {
  const cal = calibrate(SEED)
  for (const c of Object.values(cal)) {
    // the seed set is tiny, so every detector is 'sparse' — the calibration honestly reports low trust
    assert.equal(c.confidence, 'sparse')
    assert.ok(c.firings <= 10)
  }
})

test('toImplicationStrengths projects to the analyzeDebate-consumable shape', () => {
  const cal = calibrate(SEED)
  const strengths = toImplicationStrengths(cal)
  assert.ok('LOGFALL.STRAWMAN.V1' in strengths)
  assert.equal(typeof strengths['LOGFALL.STRAWMAN.V1'], 'number')
})

test('calibration is deterministic: same labels → identical strengths', () => {
  assert.deepEqual(calibrate(SEED), calibrate(SEED))
})

test('an empty labeled set yields an empty calibration (no crash, nothing to fit)', () => {
  assert.deepEqual(calibrate([]), {})
})
