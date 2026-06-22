/** Tests for the every-turn knowledge-type classifier (routing: lookup vs compute vs model). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyKnowledge } from './knowledge-type.js'

test('definition question → retrieve / lookup', () => {
  const k = classifyKnowledge('What is a catalyst?')
  assert.equal(k.dominance, 'lookup')
  assert.equal(k.solver, 'retrieve')
  assert.ok(k.types.includes('Definition'))
})

test('numeric physics question → compute', () => {
  const k = classifyKnowledge('What is the velocity of a 2 kg ball after it falls for 3 seconds?')
  assert.equal(k.solver, 'compute')
  assert.equal(k.dominance, 'compute')
})

test('an explicit equation routes to compute', () => {
  const k = classifyKnowledge('Solve 3x + 5 = 20 for x')
  assert.equal(k.solver, 'compute')
})

test('REGRESSION: clinical vignette age is NOT a math operator (no compute mis-route)', () => {
  // "55-year-old" once parsed as 55 minus year (the hyphen looked like a minus). A clinical vignette
  // with no real unit must route to reasoning/lookup, never compute.
  const k = classifyKnowledge('A 55-year-old man presents with chest pain and shortness of breath. What is the most likely diagnosis?')
  assert.notEqual(k.solver, 'compute')
  assert.notEqual(k.dominance, 'compute')
})

test('causal/process question → chain (model dominance)', () => {
  const k = classifyKnowledge('What happens when glucose levels rise after a meal?')
  assert.equal(k.dominance, 'model')
  assert.ok(['chain', 'spatial'].includes(k.solver))
})

test('compute outranks retrieve when a question is both fact-shaped and numeric', () => {
  // "what is the" (BasicFacts/retrieve) AND a quantitative ask → compute must win the priority.
  const k = classifyKnowledge('What is the force on a 5 kg mass accelerating at 2 m/s^2?')
  assert.equal(k.solver, 'compute')
})

test('always returns a usable class (never empty)', () => {
  const k = classifyKnowledge('xyzzy')
  assert.ok(k.solver)
  assert.ok(k.dominance)
  assert.ok(Array.isArray(k.types))
})
