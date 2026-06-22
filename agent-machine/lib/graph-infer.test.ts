/** Tests for rule-based inference (transitivity). Runs in CI via `npm test`. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferFacts } from './graph-infer.js'

test('infers a transitive chain (A depends-on B, B depends-on C ⟹ A depends-on C)', async () => {
  const facts = [
    { subject: 'A', predicate: 'depends on', object: 'B' },
    { subject: 'B', predicate: 'depends on', object: 'C' },
  ]
  const inferred = await inferFacts(facts, { verify: false })
  const ac = inferred.find((f) => f.subject === 'A' && f.object === 'C')
  assert.notEqual(ac, undefined, 'A depends-on C should be inferred')
  assert.equal(ac!.epistemic, 'inferred')
  assert.equal(ac!.via.includes('B'), true, 'derivation chain names the intermediate')
})

test('does NOT chain a non-transitive predicate (ownership)', async () => {
  const facts = [
    { subject: 'A', predicate: 'owns', object: 'B' },
    { subject: 'B', predicate: 'owns', object: 'C' },
  ]
  const inferred = await inferFacts(facts, { verify: false })
  assert.equal(inferred.find((f) => f.subject === 'A' && f.object === 'C'), undefined, "'owns' is not transitive — no A→C")
})

test('does not re-infer an existing fact', async () => {
  const facts = [
    { subject: 'A', predicate: 'part of', object: 'B' },
    { subject: 'B', predicate: 'part of', object: 'C' },
    { subject: 'A', predicate: 'part of', object: 'C' },   // already present
  ]
  const inferred = await inferFacts(facts, { verify: false })
  assert.equal(inferred.find((f) => f.subject === 'A' && f.object === 'C'), undefined, 'A→C already a fact, not re-inferred')
})
