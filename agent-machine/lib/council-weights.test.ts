/**
 * No-regression guard for the learned council weights (PR #246).
 * Artifact-level: catches a broken / degenerate weight export (NaN, all-zero,
 * no predictive arm, missing entries, collapsed accuracy) before it ships and
 * silently degrades every board. NOT a live board re-run (that needs the corpus
 * + GPU) — this guards the deployed artifact, which is the cheap, deterministic
 * half of "don't let a bad export through".
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COUNCIL_WEIGHTS as W } from './council-weights.js'

test('council weights: arms + feats + per-feat weight present', () => {
  assert.ok(Array.isArray(W.arms) && W.arms.length > 0, 'arms non-empty')
  assert.ok(Array.isArray(W.feats) && W.feats.length > 0, 'feats non-empty')
  for (const f of W.feats) {
    assert.ok(f in W.w, `weight present for feature ${f}`)
  }
})

test('council weights: every weight + bias is finite (no NaN/Inf from a bad fit)', () => {
  assert.ok(Number.isFinite(W.bias), 'bias finite')
  for (const [k, v] of Object.entries(W.w)) {
    assert.ok(Number.isFinite(v as number), `weight ${k} finite`)
  }
})

test('council weights: not degenerate — at least one non-zero and one predictive (positive) arm', () => {
  const vals = Object.values(W.w) as number[]
  assert.ok(vals.some((v) => v !== 0), 'not all weights zeroed out')
  assert.ok(vals.some((v) => v > 0), 'at least one positive (predictive) arm — council must learn signal')
})

test('council weights: recorded test accuracy above the regression floor', () => {
  // 4-choice random = 0.25; floor well above that catches a serious degradation
  // without being brittle to normal retrain drift (current export ~0.53).
  assert.ok(
    typeof W.softmax_test_acc === 'number' && W.softmax_test_acc >= 0.4,
    `softmax_test_acc ${W.softmax_test_acc} below floor 0.40`,
  )
})
