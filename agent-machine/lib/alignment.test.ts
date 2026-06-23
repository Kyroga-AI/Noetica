/** Tests for ingest-vs-brain alignment. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitClaims, alignClaims, type BrainStatement } from './alignment.js'

test('splitClaims yields checkable sentences, drops fragments', () => {
  const claims = splitClaims('The sky is blue. ok. Water boils at 100 degrees celsius at sea level. Hi!')
  assert.ok(claims.some((c) => c.includes('Water boils')))
  assert.ok(!claims.includes('ok'))
  assert.ok(!claims.includes('Hi!'))
})

test('alignClaims classifies corroborated / conflicting / novel against the brain', () => {
  const brain: BrainStatement[] = [
    { id: 'b1', text: 'The company revenue grew strongly last quarter', source: 'memo.md' },
    { id: 'b2', text: 'Our primary datacenter runs on renewable energy', source: 'ops.md' },
  ]
  const claims = [
    'The company revenue grew strongly last quarter',                    // corroborated (entails b1)
    'The company revenue did not grow strongly last quarter',            // conflicting (contradicts b1)
    'The new mascot is a purple otter named Pim',                        // novel (no brain match)
  ]
  const r = alignClaims(claims, brain)
  assert.equal(r.claims[0]!.verdict, 'corroborated')
  assert.equal(r.claims[0]!.match?.id, 'b1')
  assert.equal(r.claims[1]!.verdict, 'conflicting')
  assert.equal(r.claims[1]!.match?.relation, 'contradict')
  assert.equal(r.claims[2]!.verdict, 'novel')
  assert.equal(r.summary.corroborated, 1)
  assert.equal(r.summary.conflicting, 1)
  assert.equal(r.summary.novel, 1)
  assert.ok(r.summary.alignmentScore === 0)   // (1 corroborated - 1 conflicting)/3 = 0
})

test('all-corroborating news scores positive; all-conflicting scores negative', () => {
  const brain: BrainStatement[] = [{ id: 'b1', text: 'Interest rates are rising this year' }]
  assert.ok(alignClaims(['Interest rates are rising this year'], brain).summary.alignmentScore > 0)
  assert.ok(alignClaims(['Interest rates are not rising this year'], brain).summary.alignmentScore < 0)
})
