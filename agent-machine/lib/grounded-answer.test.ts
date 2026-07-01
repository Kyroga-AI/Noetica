/** Tests for the inline-binding verifier (Phase 0.4). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyInlineBinding, type GroundedAnswer } from './grounded-answer.js'

const EVIDENCE = new Map<string, string>([
  ['france.md#1', 'The capital of France is Paris.'],
  ['space.md#7', 'The Moon is a rocky body orbiting Earth.'],
])

// span 1: cited + the evidence entails it (faithful).
// span 2: cited BUT the evidence does not support it (cited-unfaithful — the frontier failure).
// span 3: no citation (honest P-GEN).
const ANSWER: GroundedAnswer = {
  text: 'Paris is the capital of France. The Moon is made of green cheese. It is a lovely city.',
  spans: [
    { text: 'Paris is the capital of France.', evidence_id: 'france.md#1' },
    { text: 'The Moon is made of green cheese.', evidence_id: 'space.md#7' },
    { text: 'It is a lovely city.' } as any,
  ],
}

// stub entail: entailed iff every content word of the claim appears in the evidence.
const stubEntail = async (ev: string, claim: string) => {
  const e = ev.toLowerCase()
  const w = claim.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((x) => x.length > 3)
  return w.every((x) => e.includes(x)) ? 1 : 0
}

test('inline binding: faithful, cited-unfaithful, and generated spans are distinguished', async () => {
  const r = await verifyInlineBinding(ANSWER, EVIDENCE, stubEntail)
  assert.equal(r.total, 3)
  assert.equal(r.faithful, 1, 'the Paris span is P-RET-faithful')
  assert.equal(r.citedUnfaithful, 1, 'the Moon-cheese span cites space.md#7 but is not entailed')
  assert.equal(r.generated, 1, 'the uncited span is P-GEN')
  assert.equal(r.faithfulAttributionRate, 0.5, '1 faithful of 2 cited')
})

test('inline binding: an unresolvable evidence_id is unfaithful, not faithful', async () => {
  const a: GroundedAnswer = { text: 'x', spans: [{ text: 'Paris is the capital of France.', evidence_id: 'nonexistent.md#99' }] }
  const r = await verifyInlineBinding(a, EVIDENCE, stubEntail)
  assert.equal(r.spans[0].resolved, false)
  assert.equal(r.spans[0].tag, 'P-RET-unfaithful')
  assert.equal(r.faithful, 0)
})
