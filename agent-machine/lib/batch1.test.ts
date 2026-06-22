/** Batch 1 — reasoning & KR: provenance, self-consistency, entailment, shapes, defeasible. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildProof, baseFacts, rulesUsed, explainProof } from './provenance.js'
import { majorityVote } from './self-consistency.js'
import { classifyEntailment } from './entailment.js'
import { validateAll } from './graph-shapes.js'
import { deriveDefeasible } from './defeasible.js'

test('provenance: proof tree resolves to base facts + rules', () => {
  // A←r1(B,C); B←r2(D). C, D base.
  const d = new Map([['A', { rule: 'r1', premises: ['B', 'C'] }], ['B', { rule: 'r2', premises: ['D'] }]])
  const p = buildProof('A', d)
  assert.deepEqual(baseFacts(p).sort(), ['C', 'D'])
  assert.deepEqual(rulesUsed(p).sort(), ['r1', 'r2'])
  assert.ok(explainProof(p).includes('A'))
})

test('provenance: cycles do not loop forever', () => {
  const d = new Map([['A', { rule: 'r', premises: ['B'] }], ['B', { rule: 'r', premises: ['A'] }]])
  assert.ok(buildProof('A', d).children.length >= 0)   // terminates
})

test('self-consistency: majority wins', () => {
  const r = majorityVote(['Paris', 'paris', 'London'])
  assert.equal(r.answer!.toLowerCase(), 'paris')
  assert.equal(r.votes, 2)
  assert.ok(Math.abs(r.fraction - 2 / 3) < 1e-9)
})

test('entailment: same polarity → entail, opposite → contradict', () => {
  assert.equal(classifyEntailment('the server is running on port 8080', 'the server runs on port 8080').relation, 'entail')
  assert.equal(classifyEntailment('the server is running on port 8080', 'the server is not running on port 8080').relation, 'contradict')
  assert.equal(classifyEntailment('cats are mammals', 'the stock market fell today').relation, 'neutral')
})

test('shapes: validation flags required/maxCount/enum violations', () => {
  const v = validateAll(
    [{ id: 'n1', kind: 'STEWARDSHIP_RECORD', props: { status: 'weird', keepers: ['a', 'b'] } }],
    [{ kind: 'STEWARDSHIP_RECORD', required: ['scope'], maxCount: { keepers: 1 }, enumOf: { status: ['active', 'orphaned'] } }],
  )
  assert.equal(v.some((x) => x.constraint === 'required' && x.property === 'scope'), true)
  assert.equal(v.some((x) => x.constraint === 'maxCount' && x.property === 'keepers'), true)
  assert.equal(v.some((x) => x.constraint === 'enum' && x.property === 'status'), true)
})

test('defeasible: penguin retracts flight (penguin > bird)', () => {
  const { conclusions, retracted } = deriveDefeasible(
    ['penguin', 'bird'],
    [{ id: 'r1', antecedent: ['bird'], consequent: 'flies' }, { id: 'r2', antecedent: ['penguin'], consequent: '!flies' }],
    [{ winner: 'r2', loser: 'r1' }],
  )
  assert.equal(conclusions.includes('!flies'), true, 'the more specific rule wins')
  assert.equal(conclusions.includes('flies'), false)
  assert.equal(retracted.includes('flies'), true)
})

test('defeasible: unresolved conflict concludes neither', () => {
  const { conclusions } = deriveDefeasible(
    ['x'],
    [{ id: 'a', antecedent: ['x'], consequent: 'p' }, { id: 'b', antecedent: ['x'], consequent: '!p' }],
    [],
  )
  assert.equal(conclusions.includes('p'), false)
  assert.equal(conclusions.includes('!p'), false)
})
