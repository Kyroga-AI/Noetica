/** Tests for the canonical cosine similarity (the converged 5-copy implementation). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cosineSim } from './vec-sim.js'

test('identical vectors → 1, orthogonal → 0, opposite → -1', () => {
  assert.ok(Math.abs(cosineSim([1, 2, 3], [1, 2, 3]) - 1) < 1e-9)
  assert.equal(cosineSim([1, 0], [0, 1]), 0)
  assert.ok(Math.abs(cosineSim([1, 2], [-1, -2]) + 1) < 1e-9)
})

test('empty or zero vector → 0 (never NaN)', () => {
  assert.equal(cosineSim([], [1, 2]), 0)
  assert.equal(cosineSim([0, 0], [1, 2]), 0)
})

test('accepts Float32Array and mixed inputs', () => {
  assert.ok(Math.abs(cosineSim(Float32Array.from([1, 2, 3]), [1, 2, 3]) - 1) < 1e-6)
})

test('compares over the shorter length', () => {
  assert.ok(Math.abs(cosineSim([1, 2, 3, 999], [1, 2, 3]) - 1) < 1e-9)
})

test('a NaN / Infinity element yields 0, never a NaN score (poisoned-vector guard)', () => {
  assert.equal(cosineSim([1, NaN, 3], [1, 2, 3]), 0)
  assert.equal(cosineSim([1, Infinity], [1, 2]), 0)
})
