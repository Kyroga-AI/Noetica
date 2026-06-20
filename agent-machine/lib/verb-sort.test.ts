import { test } from 'node:test'
import assert from 'node:assert'
import { sortVerb, spanningCheck, adjointClosure, type Verb } from './verb-sort.js'

const TAU = 0.6

// The 10 seed fixtures from the brief (probe fields authored to lock the pipeline logic).
const FIXTURES: { v: Verb; expect: string }[] = [
  { v: { id: 'create', label: 'create', operandType: 'topic', decomposition: null, independence: 1, historyDependent: false }, expect: 'PRIMITIVE' },
  { v: { id: 'retrieve', label: 'retrieve', operandType: 'topic', decomposition: null, independence: 1, historyDependent: false }, expect: 'PRIMITIVE' },
  { v: { id: 'transform', label: 'transform', operandType: 'topic', decomposition: null, independence: 1, historyDependent: false }, expect: 'PRIMITIVE' },
  { v: { id: 'evaluate', label: 'evaluate', operandType: 'topic', decomposition: null, independence: 1, historyDependent: false }, expect: 'PRIMITIVE' },
  { v: { id: 'execute', label: 'execute', operandType: 'topic', decomposition: null, independence: 1, historyDependent: false }, expect: 'PRIMITIVE' },
  { v: { id: 'explain', label: 'explain', operandType: 'topic', decomposition: { mediator: 'identity', constituents: ['transform'], slotBinding: { output_form: 'communicative' } }, independence: 1, historyDependent: false }, expect: 'REDUCIBLE' },
  { v: { id: 'compare', label: 'compare', operandType: 'topic', decomposition: { mediator: 'combine', constituents: ['retrieve', 'retrieve', 'evaluate'] }, independence: 0.92, historyDependent: false }, expect: 'REDUCIBLE' },
  { v: { id: 'monitor', label: 'monitor', operandType: 'topic', decomposition: { mediator: 'entangle', constituents: ['retrieve', 'evaluate'] }, independence: 0.18, historyDependent: true }, expect: 'ENTANGLEMENT' },
  { v: { id: 'govern', label: 'govern', operandType: 'action', decomposition: null, independence: 1, historyDependent: false }, expect: 'META' },
  { v: { id: 'plan', label: 'plan', operandType: 'action', decomposition: { mediator: 'entangle', constituents: ['evaluate', 'execute'] }, independence: 0.3, historyDependent: true }, expect: 'META' },
]

test('CI-1: all 10 seed fixtures green', () => {
  const basis: string[] = []
  for (const { v, expect } of FIXTURES) {
    const vd = sortVerb(v, TAU)
    assert.equal(vd.verdict, expect, `${v.id}: got ${vd.verdict}, expected ${expect}`)
    if (vd.verdict === 'PRIMITIVE') basis.push(v.id)
  }
  assert.deepEqual(basis, ['create', 'retrieve', 'transform', 'evaluate', 'execute'])
  assert.equal(basis.length, 5)
})

test('CI-3: ORDER fires before FACTORIZATION (plan is META despite an entangling decomposition)', () => {
  const plan = FIXTURES.find((f) => f.v.id === 'plan')!.v
  const vd = sortVerb(plan, TAU)
  assert.equal(vd.verdict, 'META')
  assert.equal(vd.testFired, 'ORDER') // not FACTORIZATION, even though it would entangle
  assert.equal(vd.placement, 'embedding')
})

test('placements + bars: monitor entangles with PERSISTENCE; reducibles place nowhere', () => {
  const monitor = sortVerb(FIXTURES.find((f) => f.v.id === 'monitor')!.v, TAU)
  assert.equal(monitor.placement, 'embedding')
  assert.deepEqual(monitor.extraFidelityBar, ['PERSISTENCE'])
  assert.equal(sortVerb(FIXTURES.find((f) => f.v.id === 'explain')!.v, TAU).placement, 'none')
})

test('CI-4: spanning count is a pure function of basis length; never padded toward 10', () => {
  const r5 = spanningCheck(['create', 'retrieve', 'transform', 'evaluate', 'execute'], [], () => true)
  assert.equal(r5.count, 5)
  assert.equal(r5.tenHypothesis, 'REFUTED_LOW') // honest: 5, not forced to 10
  const r10 = spanningCheck(Array.from({ length: 10 }, (_, i) => `p${i}`), [], () => true)
  assert.equal(r10.tenHypothesis, 'CONFIRMED')
})

test('adjoint closure: the 5 close at 6 = 3×2 when sense is added — NOT 10', () => {
  const six = ['create', 'retrieve', 'transform', 'evaluate', 'execute', 'sense']
  const c = adjointClosure(six)
  assert.equal(c.count, 6)
  assert.equal(c.factorization, '3 substrates × 2 polarities')
  assert.equal(c.closed, true)                  // every (substrate × polarity) cell filled exactly once
  assert.equal(c.tenHypothesis, 'REFUTED_LOW')  // 6, with a factorization — not padded to 10
})

test('axis guards: evaluate ⊥ sense (polarity) AND substrate-complete (no 4th substrate)', () => {
  const c = adjointClosure(['create', 'retrieve', 'transform', 'evaluate', 'execute', 'sense'])
  // The two refutations 6 must survive: read-held ≠ read-world, and exactly 3 substrates.
  assert.equal(c.tests.evaluate_perp_sense, true)  // held ≠ world — the basis doesn't collapse to 5
  assert.equal(c.tests.substrate_complete, true)   // {store, held, world}, no social/4th → not 8
})

test('closure is minimal: the raw 5 (no sense) is NOT closed — execute dangles', () => {
  const c = adjointClosure(['create', 'retrieve', 'transform', 'evaluate', 'execute'])
  assert.equal(c.closed, false) // world:read cell empty → execute unpaired → not yet a clean basis
})

test('CI-5 seam-isolation: a verb with no decomposition is invariant to SEAM-A/B values', () => {
  const base: Verb = { id: 'x', label: 'x', operandType: 'topic', decomposition: null, independence: 1, historyDependent: false }
  const a = sortVerb(base, TAU)
  const b = sortVerb({ ...base, independence: 0.0, historyDependent: true }, TAU) // perturb the seams
  assert.equal(a.verdict, b.verdict) // PRIMITIVE either way — irreducible doesn't read the seams
})
