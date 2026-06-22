/** Tests for entity resolution (edit-distance + embedding fusion). Runs in CI via `npm test`. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveEntities } from './graph-resolve.js'

const noVectors = new Map<string, number[]>()

test('flags near-identical labels as merge candidates (string axis alone)', () => {
  const entities = [
    { id: '1', label: 'model-router' },
    { id: '2', label: 'model router' },
    { id: '3', label: 'database' },
  ]
  const cands = resolveEntities(entities, noVectors, { minConfidence: 0.8 })
  const mr = cands.find((c) => (c.a === 'model-router' && c.b === 'model router') || (c.a === 'model router' && c.b === 'model-router'))
  assert.notEqual(mr, undefined, "'model-router' ≈ 'model router' should be a candidate")
  assert.equal(mr!.confidence >= 0.8, true)
  // unrelated label is not a candidate with anything
  assert.equal(cands.some((c) => c.a === 'database' || c.b === 'database'), false)
})

test('does not flag clearly distinct entities', () => {
  const entities = [
    { id: '1', label: 'authentication' },
    { id: '2', label: 'visualization' },
  ]
  assert.equal(resolveEntities(entities, noVectors, { minConfidence: 0.8 }).length, 0)
})

test('uses the semantic axis when embeddings are present', () => {
  // identical unit vectors → cosine 1.0 → near-identical meaning even with different surface forms
  const entities = [
    { id: '1', label: 'car' },
    { id: '2', label: 'automobile' },
  ]
  const vectors = new Map<string, number[]>([['1', [1, 0, 0]], ['2', [1, 0, 0]]])
  const cands = resolveEntities(entities, vectors, { minConfidence: 0.85 })
  assert.equal(cands.length >= 1, true, 'cosine 1.0 → near-identical-meaning candidate')
  assert.equal(cands[0]!.semanticSim >= 0.9, true)
})
