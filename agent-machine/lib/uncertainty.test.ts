/** Tests for semantic-entropy uncertainty + calibrated abstention. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { semanticClusters, semanticEntropy, normalizedEntropy, decideAnswer } from './uncertainty.js'

// trivial equivalence: case/space-insensitive exact match (stands in for NLI/embedding cosine)
const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

test('identical answers form one cluster with zero entropy', () => {
  const c = semanticClusters(['Paris', 'paris', 'PARIS'], eq)
  assert.equal(c.length, 1)
  assert.equal(semanticEntropy(c), 0)
  assert.equal(normalizedEntropy(c), 0)
})

test('all-different answers maximize entropy', () => {
  const c = semanticClusters(['A', 'B', 'C', 'D'], eq)
  assert.equal(c.length, 4)
  assert.ok(Math.abs(normalizedEntropy(c) - 1) < 1e-9, 'four distinct → max normalized entropy')
})

test('a clear majority lowers entropy below total disagreement', () => {
  const c = semanticClusters(['Paris', 'Paris', 'Paris', 'London'], eq)
  assert.equal(c.length, 2)
  assert.ok(normalizedEntropy(c) > 0 && normalizedEntropy(c) < 1)
})

test('decideAnswer: grounded + confident → answer', () => {
  assert.equal(decideAnswer({ verified: true, coverage: 0.9, entropy: 0.1 }), 'answer')
})

test('decideAnswer: ungrounded + high entropy → abstain (the confabulation case)', () => {
  assert.equal(decideAnswer({ verified: false, coverage: 0.0, entropy: 0.9 }), 'abstain')
})

test('decideAnswer: ungrounded but self-consistent → hedge, not abstain', () => {
  assert.equal(decideAnswer({ verified: false, coverage: 0.0, entropy: 0.1 }), 'hedge')
})

test('decideAnswer: grounded but model-uncertain → hedge', () => {
  assert.equal(decideAnswer({ verified: true, coverage: 0.8, entropy: 0.8 }), 'hedge')
})

test('decideAnswer: grounded but thin coverage → hedge', () => {
  assert.equal(decideAnswer({ verified: true, coverage: 0.2, entropy: 0.1 }), 'hedge')
})
