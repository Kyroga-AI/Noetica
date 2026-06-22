/** Wave-3 Batch E — quality/privacy/safety: conformal, semantic-probe, dp-export, content-credentials, capability-egress. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calibrateThreshold, shouldAbstain, coverageAt } from './conformal.js'
import { scoreSpread, answerStability } from './semantic-probe.js'
import { laplaceNoise, privatizeCount } from './dp-export.js'
import { makeCredential, manifestDigest, markAIGenerated } from './content-credentials.js'
import { gateEgress, deriveValueTrust } from './capability-egress.js'

test('conformal: threshold bounds accepted-set error ≤ alpha', () => {
  const calib = [
    { score: 0.9, correct: true }, { score: 0.85, correct: true }, { score: 0.8, correct: true },
    { score: 0.4, correct: false }, { score: 0.3, correct: false },
  ]
  const t = calibrateThreshold(calib, 0.1)
  assert.ok(t > 0.4 && t <= 0.8, 'threshold lands above the wrong low-confidence ones')
  assert.equal(shouldAbstain(0.3, t), true)
  assert.equal(shouldAbstain(0.9, t), false)
  assert.ok(coverageAt(calib, t) < 1)
})

test('semantic-probe: spread + stability flag uncertainty', () => {
  assert.equal(scoreSpread([0.8, 0.82, 0.79]).uncertain, false, 'tight cluster → certain')
  assert.equal(scoreSpread([0.1, 0.9, 0.5]).uncertain, true, 'wide spread → uncertain')
  assert.ok(answerStability(['Paris', 'Paris', 'London']) - 2 / 3 < 1e-9)
})

test('dp-export: Laplace noise is symmetric; privatized count is non-negative', () => {
  assert.ok(Math.abs(laplaceNoise(1, 1, 0.5)) < 1e-6, 'u=0.5 → ~0 noise')
  assert.ok(laplaceNoise(1, 1, 0.9) > 0 && laplaceNoise(1, 1, 0.1) < 0, 'sign tracks u')
  assert.ok(privatizeCount(5, 1, 0.5) >= 0)
})

test('content-credentials: deterministic digest + idempotent AI marker', () => {
  const cred = makeCredential({ model: 'claude-opus-4-8', timestamp: '2026-06-22T00:00:00Z', sourceRefs: ['doc1'] })
  assert.equal(manifestDigest(cred), manifestDigest(makeCredential({ model: 'claude-opus-4-8', timestamp: '2026-06-22T00:00:00Z', sourceRefs: ['doc1'] })), 'deterministic')
  const marked = markAIGenerated('Hello', cred)
  assert.equal(marked.includes('c2pa:ai-generated'), true)
  assert.equal(markAIGenerated(marked, cred), marked, 'idempotent')
})

test('capability-egress: untrusted argument blocks an egress requiring trust; taint propagates', () => {
  const blocked = gateEgress([{ value: 'x', trust: 'untrusted' }, { value: 'y', trust: 'trusted' }], { requires: 'internal' })
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.combined, 'untrusted', 'weakest input wins')
  const ok = gateEgress([{ value: 'x', trust: 'trusted' }], { requires: 'internal' })
  assert.equal(ok.allowed, true)
  assert.equal(deriveValueTrust('z', [{ value: 'a', trust: 'internal' }, { value: 'b', trust: 'untrusted' }]).trust, 'untrusted')
})
