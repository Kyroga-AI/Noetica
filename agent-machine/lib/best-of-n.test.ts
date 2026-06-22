/** Tests for verifier-reranked best-of-N selection. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectBestOfN, argmaxBy, shouldStop } from './best-of-n.js'

test('a grounded candidate beats an ungrounded one even with lower coverage', () => {
  const { best } = selectBestOfN([
    { text: 'ungrounded but fluent', verified: false, coverage: 0.95 },
    { text: 'grounded answer', verified: true, coverage: 0.6 },
  ])
  assert.equal(best!.text, 'grounded answer', 'we trust verification over fluency')
})

test('among grounded candidates, higher coverage wins', () => {
  const { best } = selectBestOfN([
    { text: 'a', verified: true, coverage: 0.7 },
    { text: 'b', verified: true, coverage: 0.92 },
  ])
  assert.equal(best!.text, 'b')
})

test('secondary score breaks coverage ties', () => {
  const { best } = selectBestOfN([
    { text: 'a', verified: true, coverage: 0.8, score: 0.2 },
    { text: 'b', verified: true, coverage: 0.8, score: 0.9 },
  ])
  assert.equal(best!.text, 'b')
})

test('agreement reflects self-consistency among candidates', () => {
  const { agreement } = selectBestOfN([
    { text: 'Paris', verified: true, coverage: 0.9 },
    { text: 'paris', verified: true, coverage: 0.8 },
    { text: 'London', verified: true, coverage: 0.85 },
  ])
  assert.ok(Math.abs(agreement - 2 / 3) < 1e-9, 'two of three agree with the winner')
})

test('empty input yields no winner', () => {
  const r = selectBestOfN([])
  assert.equal(r.best, null)
  assert.equal(r.agreement, 0)
})

test('argmaxBy picks the max', () => {
  assert.equal(argmaxBy([{ v: 1 }, { v: 9 }, { v: 3 }], (x) => x.v)!.v, 9)
  assert.equal(argmaxBy([], (x: { v: number }) => x.v), null)
})

test('shouldStop fires only on a grounded winner with agreement or high coverage', () => {
  assert.equal(shouldStop({ best: { text: 'x', verified: false, coverage: 0.99 }, agreement: 1 }), false, 'never stop on ungrounded')
  assert.equal(shouldStop({ best: { text: 'x', verified: true, coverage: 0.5 }, agreement: 0.7 }), true, 'strong agreement → stop')
  assert.equal(shouldStop({ best: { text: 'x', verified: true, coverage: 0.95 }, agreement: 0.1 }), true, 'high coverage → stop')
  assert.equal(shouldStop({ best: { text: 'x', verified: true, coverage: 0.5 }, agreement: 0.2 }), false, 'weak everything → keep sampling')
})
