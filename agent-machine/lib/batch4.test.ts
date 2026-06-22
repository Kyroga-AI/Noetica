/** Batch 4 — eval/quality + retrieval: rag-eval, judge, calibration, eval-capture, late-interaction. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contextPrecision, contextRecall, contextualPrecisionAtK, noiseLeadingRanks } from './rag-eval.js'
import { swapRobustWinner, juryVote } from './judge.js'
import { brier, ece, riskCoverage } from './calibration.js'
import { captureFailure, dedupeCases } from './eval-capture.js'
import { maxSim, rerankLate } from './late-interaction.js'

test('rag-eval: precision, recall, order-aware precision, noise', () => {
  assert.equal(contextPrecision([{ relevant: true }, { relevant: false }]), 0.5)
  assert.equal(contextRecall(['a', 'b'], ['a', 'b', 'c']), 2 / 3)
  // relevant ranked first scores higher than relevant ranked last
  assert.ok(contextualPrecisionAtK([true, false, false]) > contextualPrecisionAtK([false, false, true]))
  assert.equal(noiseLeadingRanks([false, false, true]), 2)
})

test('judge: position-swap kills a verdict that flips with order; jury votes majority', () => {
  assert.equal(swapRobustWinner('a', 'b'), 'a', "a won both framings (b in swapped = a unflipped) → robust a")
  assert.equal(swapRobustWinner('a', 'a'), 'tie', 'verdict flipped with position → tie (position bias)')
  assert.equal(juryVote(['a', 'a', 'b']).winner, 'a')
})

test('calibration: brier/ece reward honest confidence; risk-coverage is monotone-ish', () => {
  const perfect = [{ confidence: 1, correct: true }, { confidence: 0, correct: false }]
  assert.equal(brier(perfect), 0)
  const overconfident = [{ confidence: 1, correct: false }, { confidence: 1, correct: false }]
  assert.ok(brier(overconfident) > brier(perfect))
  assert.ok(ece(overconfident) > 0.9)
  const rc = riskCoverage([{ confidence: 0.9, correct: true }, { confidence: 0.1, correct: false }])
  assert.equal(rc[0]!.risk, 0, 'most-confident answered first is correct → 0 risk at low coverage')
})

test('eval-capture: only failures become cases; dedupe keeps latest', () => {
  assert.equal(captureFailure({ input: 'q', output: 'a', verified: true, coverage: 0.9 }, 1), null, 'good output not captured')
  const c = captureFailure({ input: 'q', output: 'a', verified: false, coverage: 0.1 }, 1)
  assert.equal(c!.failureMode, 'ungrounded')
  const deduped = dedupeCases([{ input: 'Q', output: 'x', failureMode: 'a', coverage: 0, capturedAt: 1 }, { input: 'q', output: 'y', failureMode: 'b', coverage: 0, capturedAt: 2 }])
  assert.equal(deduped.length, 1)
  assert.equal(deduped[0]!.capturedAt, 2)
})

test('late-interaction: MaxSim rewards token-level matches; rerank orders by it', () => {
  const q = [[1, 0, 0], [0, 1, 0]]
  const docMatch = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]   // contains both query tokens
  const docMiss = [[0, 0, 1], [0, 0, 1]]               // matches neither
  assert.ok(maxSim(q, docMatch) > maxSim(q, docMiss))
  const ranked = rerankLate(q, [{ id: 'miss', vecs: docMiss }, { id: 'match', vecs: docMatch }], 2)
  assert.equal(ranked[0]!.id, 'match')
})
