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
  assert.equal(assessEffort('build a big system', 'build_implement', { standardCeiling: 5 }).maxBestOfN, 5)
  assert.equal(assessEffort('hi', 'converse_smalltalk', { standardCeiling: 5 }).maxBestOfN, 1) // light still caps to 1
})

test('a short but compute/model-dominated question is NOT downgraded to light', () => {
  // a terse hard ask the intent cues miss, but knowledge-type flags as compute/model → stays standard
  const c = assessEffort('antiderivative of x squared sine x', 'general', { dominance: 'compute' })
  assert.notEqual(c.tier, 'light')
  const m = assessEffort('why is the sky blue at sunset', 'general', { dominance: 'model' })
  assert.notEqual(m.tier, 'light')
  // a short LOOKUP question is still light (a plain fact, no deliberation needed)
  assert.equal(assessEffort('capital of France', 'general', { dominance: 'lookup' }).tier, 'light')
})
