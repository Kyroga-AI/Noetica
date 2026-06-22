/** Tests for the lexical-normalization contract (Porter stem + stopword drop) the brain rerank relies on. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stem, isStopword, normalizeTerms, termSet } from './text-normalize.js'

test('stem collapses inflections to a common root', () => {
  assert.equal(stem('running'), 'run')
  assert.equal(stem('selecting'), stem('selected')) // both reach the same stem
  assert.equal(stem('cats'), 'cat')
})

test('stopwords are recognized, content words are not', () => {
  assert.equal(isStopword('the'), true)
  assert.equal(isStopword('are'), true)
  assert.equal(isStopword('mitochondria'), false)
})

test('normalizeTerms drops stopwords and stems the rest', () => {
  const t = normalizeTerms('The cats are running fast')
  assert.ok(t.includes('run'), JSON.stringify(t))
  assert.ok(t.includes('cat'), JSON.stringify(t))
  assert.ok(!t.includes('the'))
  assert.ok(!t.includes('are'))
})

test('termSet dedups inflections of the same root', () => {
  const s = termSet('run running runs')
  assert.equal(s.size, 1)
  assert.ok(s.has('run'))
})
