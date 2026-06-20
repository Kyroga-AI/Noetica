import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyComplexity, calibratedConfidence } from './complexity-discipline.js'

test('classifies postures from the task shape', () => {
  assert.equal(classifyComplexity('Compute the determinant of [[2,1],[1,3]]').posture, 'compute')
  assert.equal(classifyComplexity('Prove that there is no polynomial algorithm for SAT').posture, 'prove')
  assert.equal(classifyComplexity('Find the smallest n such that...').posture, 'search-verify')
  assert.equal(classifyComplexity('Who discovered penicillin?').posture, 'lookup')
})

test('lower-bound/impossibility claims attach the proof barriers', () => {
  const v = classifyComplexity('Show that P != NP (no polynomial algorithm)')
  assert.equal(v.posture, 'prove')
  assert.deepEqual(v.barriers, ['relativization', 'natural-proofs', 'algebrization'])
  assert.ok(v.nonClaims.some((s) => /barrier/i.test(s)))
})

test('confidence is calibrated: barriers cap it, verification lifts it', () => {
  const prove = classifyComplexity('Prove P != NP (no polynomial algorithm)')
  assert.ok(calibratedConfidence(prove, { grounded: true }) <= 0.35, 'barrier caps confidence')
  const compute = classifyComplexity('Compute the integral of x^2 from 0 to 1')
  assert.ok(calibratedConfidence(compute, { codeVerified: true, grounded: true }) > 0.85, 'verified computation is high-confidence')
})

test('no confident hallucinated proofs — prove posture is inherently low base', () => {
  assert.ok(classifyComplexity('Prove the Riemann hypothesis').baseConfidence <= 0.3)
})

test('coding context routes to the coder; math does NOT load the coder', async () => {
  const { modelForPosture } = await import('./complexity-discipline.js')
  assert.equal(classifyComplexity('Debug this python function and refactor the class').posture, 'code')
  assert.equal(modelForPosture('code'), 'qwen2.5-coder:7b')
  assert.equal(modelForPosture('compute'), 'qwen2.5:7b') // math uses general model, no coder
  assert.notEqual(classifyComplexity('Compute the determinant of [[2,1],[1,3]]').posture, 'code')
})
