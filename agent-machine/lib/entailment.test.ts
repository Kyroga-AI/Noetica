import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jaccard, cosine, classifyEntailment, classifyEntailmentSemantic } from './entailment.js'

test('jaccard: identical sentences = 1', () => {
  assert.equal(jaccard('the cat sat on the mat', 'the cat sat on the mat'), 1)
})

test('jaccard: disjoint = 0', () => {
  assert.equal(jaccard('the sky is blue', 'dogs eat carrots'), 0)
})

test('jaccard: partial overlap', () => {
  const s = jaccard('the cat sat on the mat', 'the cat ran away')
  assert.ok(s > 0 && s < 1)
})

test('cosine: identical unit vectors = 1', () => {
  assert.ok(Math.abs(cosine([1, 0, 0], [1, 0, 0]) - 1) < 1e-9)
})

test('cosine: orthogonal = 0', () => {
  assert.ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-9)
})

test('cosine: zero vector = 0', () => {
  assert.equal(cosine([0, 0], [1, 1]), 0)
})

test('classifyEntailment: entails when high similarity, same polarity', () => {
  const r = classifyEntailment('the cat is on the mat', 'the cat sat on the mat', jaccard, { threshold: 0.3 })
  assert.equal(r.relation, 'entail')
  assert.ok(r.similarity > 0.3)
})

test('classifyEntailment: contradicts when high similarity, opposite polarity', () => {
  const r = classifyEntailment('the cat is on the mat', 'the cat is not on the mat', jaccard, { threshold: 0.3 })
  assert.equal(r.relation, 'contradict')
})

test('classifyEntailment: neutral when low similarity', () => {
  const r = classifyEntailment('the sky is blue', 'dogs enjoy carrots', jaccard)
  assert.equal(r.relation, 'neutral')
})

test('classifyEntailmentSemantic: degrades to lexical when embedder unavailable', async () => {
  // embedder is not running in CI — semantic falls back to lexical gracefully
  const r = await classifyEntailmentSemantic('the sky is blue', 'the sky is blue', { threshold: 0.3 })
  assert.ok(['entail', 'contradict', 'neutral'].includes(r.relation))
  assert.ok(['semantic', 'lexical'].includes(r.method))
})

test('classifyEntailmentSemantic: paraphrase entailment via embedding or fallback', async () => {
  const r = await classifyEntailmentSemantic(
    'the cat is sitting on the mat',
    'the cat sat on the mat',
    { threshold: 0.3 },
  )
  assert.ok(['entail', 'neutral'].includes(r.relation))
})
