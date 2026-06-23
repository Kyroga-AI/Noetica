/** Tests for the effort gate — trivial in, trivial out; complex work never downgraded. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessEffort } from './effort.js'

test('light intents are light (single sample, no deliberation)', () => {
  for (const i of ['converse_smalltalk', 'everyday', 'status_check', 'meta_capability']) {
    const e = assessEffort('hello there', i)
    assert.equal(e.tier, 'light', i)
    assert.equal(e.maxBestOfN, 1, i)
  }
})

test('a short single-clause question is light regardless of (non-heavy) intent', () => {
  const e = assessEffort('what is the capital of France', 'general')
  assert.equal(e.tier, 'light')
  assert.equal(e.maxBestOfN, 1)
})

test('heavy intents are never downgraded', () => {
  for (const i of ['build_implement', 'fix_debug', 'prove_reason', 'plan_nextsteps']) {
    const e = assessEffort('build it', i)
    assert.equal(e.tier, 'heavy', i)
    assert.ok(e.maxBestOfN >= 3, i)
  }
})

test('an explicit thoroughness/scale signal forces heavy even on a non-heavy intent', () => {
  const e = assessEffort('give me a comprehensive step-by-step breakdown of how this works', 'explain_teach')
  assert.equal(e.tier, 'heavy')
})

test('a long compound request is standard (not downgraded)', () => {
  const e = assessEffort('explain how transformers work and then compare them to RNNs for long sequences', 'explain_teach')
  assert.notEqual(e.tier, 'light')
})

test('the standard ceiling is honored (never spends MORE than configured)', () => {
  assert.equal(assessEffort('build a big system', 'build_implement', 5).maxBestOfN, 5)
  assert.equal(assessEffort('hi', 'converse_smalltalk', 5).maxBestOfN, 1) // light still caps to 1
})
