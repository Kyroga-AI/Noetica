import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractClaimEntities, scoreGraphGrounding } from './pln-judgment.js'

test('extractClaimEntities pulls proper nouns and quoted terms', () => {
  const ents = extractClaimEntities('The service uses Redis and "JWT tokens" deployed on Kubernetes.')
  assert.ok(ents.includes('Redis'))
  assert.ok(ents.includes('Kubernetes'))
  assert.ok(ents.includes('JWT tokens'))
})

test('extractClaimEntities skips sentence-initial stopwords', () => {
  const ents = extractClaimEntities('This is fine. That works too.')
  assert.ok(!ents.includes('This'))
  assert.ok(!ents.includes('That'))
})

test('scoreGraphGrounding is confidence-weighted', () => {
  const known: Record<string, number> = { redis: 0.9, kubernetes: 0.6 }
  const r = scoreGraphGrounding(['Redis', 'Kubernetes', 'Atlantis'], (e) => {
    const c = known[e.toLowerCase()]
    return c !== undefined ? { found: true, confidence: c } : { found: false, confidence: 0 }
  })
  assert.deepEqual(r.grounded.sort(), ['Kubernetes', 'Redis'])
  assert.deepEqual(r.novel, ['Atlantis'])
  // (0.9 + 0.6 + 0) / 3 = 0.5
  assert.equal(r.graphGrounding, 0.5)
})

test('scoreGraphGrounding handles no entities', () => {
  const r = scoreGraphGrounding([], () => ({ found: false, confidence: 0 }))
  assert.equal(r.graphGrounding, 0)
})
