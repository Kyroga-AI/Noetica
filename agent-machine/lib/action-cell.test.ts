import { test } from 'node:test'
import assert from 'node:assert'
import { routeForAction, makeCell, clears, ACTION_COLUMNS } from './action-cell.js'

test('polarity routing: reads are interactive (faithful), writes are deliberate (generative)', () => {
  // read covectors → interactive tier
  for (const a of ['retrieve', 'evaluate', 'sense']) assert.equal(routeForAction(a).tier, 'interactive', a)
  // write vectors → deliberate tier
  for (const a of ['create', 'transform', 'execute']) assert.equal(routeForAction(a).tier, 'deliberate', a)
})

test('substrate picks the concrete mesh node', () => {
  assert.equal(routeForAction('retrieve').target, 'rag')       // store:read
  assert.equal(routeForAction('evaluate').target, 'vj')        // held:read  — VJ is the read-held operator
  assert.equal(routeForAction('sense').target, 'capture')      // world:read — the capture layer (+1 column)
  assert.equal(routeForAction('transform').target, 'generator')// held:write — the language model
  assert.equal(routeForAction('execute').target, 'executor')   // world:write
})

test('a valid cell carries its cone; the bar clears only when context satisfies it', () => {
  const cell = makeCell({
    topic: 'water-risk', action: 'evaluate', valid: true,
    fidelityBar: [{ requires: 'doc', rationale: 'evaluate reads held state — needs the held doc', falsifiedBy: 'no doc in context' }],
  })
  assert.equal(cell.polarity, 'read')
  assert.equal(cell.route.tier, 'interactive')
  assert.deepEqual(clears(cell, (k) => k === 'doc'), { clear: true, residual: [] })
  const blocked = clears(cell, () => false)
  assert.equal(blocked.clear, false)
  assert.equal(blocked.residual.length, 1) // elicit the missing 'doc'
})

test('empty cells are signal: invalid carries a reason, no bar, no false validity', () => {
  const empty = makeCell({ topic: 'smalltalk', action: 'execute', valid: false, emptyReason: 'no world-state to write for a conversational topic' })
  assert.equal(empty.valid, false)
  assert.match(empty.emptyReason!, /no world-state/)
  assert.deepEqual(empty.fidelityBar, []) // a non-cell has no admissibility cone
})

test('attestation is deterministic (SEAM-C) and the 6 columns are exhaustive', () => {
  const a = makeCell({ topic: 't', action: 'sense', valid: true })
  const b = makeCell({ topic: 't', action: 'sense', valid: true })
  assert.equal(a.attestation, b.attestation)
  assert.equal(ACTION_COLUMNS.length, 6)
})
