/** Tests for the phantom dynamical-systems anomaly detector (ESN + FTLE). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectAnomalies, ftleSeries } from './phantom-anomaly.js'

/** A clean sinusoid — a well-modelled regime the ESN should predict well. */
function sine(n: number, period = 20): number[] {
  return Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * i) / period))
}

test('clean periodic signal produces few or no anomalies', () => {
  const r = detectAnomalies(sine(200), { zThreshold: 4 })
  assert.ok(r.anomalies.length <= 5, `expected ~no anomalies on a clean sine, got ${r.anomalies.length}`)
})

test('injected discontinuity is flagged as anomalous', () => {
  const s = sine(200)
  // Inject a sharp out-of-regime jump.
  for (let i = 120; i < 125; i++) s[i] = 8
  const r = detectAnomalies(s, { zThreshold: 3 })
  const flaggedNearJump = r.anomalies.some((i) => i >= 118 && i <= 130)
  assert.ok(flaggedNearJump, `expected an anomaly near the injected jump; flagged: ${r.anomalies}`)
})

test('deterministic: same seed yields identical scores', () => {
  const s = sine(120)
  const a = detectAnomalies(s, { seed: 42 })
  const b = detectAnomalies(s, { seed: 42 })
  assert.deepEqual(a.anomalies, b.anomalies)
  assert.equal(a.points[50]!.esnZ, b.points[50]!.esnZ)
})

test('short series returns a clean, non-throwing result', () => {
  const r = detectAnomalies([1, 2, 3])
  assert.equal(r.anomalies.length, 0)
  assert.equal(r.points.length, 3)
})

test('ESN models a learnable signal (finite training RMSE)', () => {
  const r = detectAnomalies(sine(200))
  assert.ok(Number.isFinite(r.esnTrainRmse))
  assert.ok(r.esnTrainRmse >= 0)
})

test('FTLE rises in a divergent/chaotic stretch vs a flat stretch', () => {
  // Flat then a logistic-map chaotic burst (classic positive-Lyapunov regime).
  const flat = new Array(60).fill(0.5)
  const chaos: number[] = [0.4]
  for (let i = 1; i < 60; i++) chaos.push(3.9 * chaos[i - 1]! * (1 - chaos[i - 1]!))
  const ftleFlat = ftleSeries(flat)
  const ftleChaos = ftleSeries(chaos)
  const meanAbs = (a: number[]) => a.reduce((s, v) => s + Math.abs(v), 0) / a.length
  assert.ok(meanAbs(ftleChaos) > meanAbs(ftleFlat), 'chaotic stretch should show larger FTLE magnitude')
})

test('every point carries both detector scores', () => {
  const r = detectAnomalies(sine(80))
  for (const p of r.points) {
    assert.equal(typeof p.esnZ, 'number')
    assert.equal(typeof p.ftle, 'number')
    assert.equal(typeof p.anomalous, 'boolean')
  }
})
