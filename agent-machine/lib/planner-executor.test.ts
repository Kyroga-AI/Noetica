import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newProgress, recordProgress, shouldReplan, stateSignature, confirmFact } from './planner-executor.js'

test('stateSignature: is stable (sorted + deduped)', () => {
  assert.equal(stateSignature(['b', 'a', 'a']), stateSignature(['a', 'b']))
})

test('stateSignature: differs for different facts', () => {
  assert.notEqual(stateSignature(['a']), stateSignature(['b']))
})

test('recordProgress: starts with 0 stalls', () => {
  assert.equal(newProgress().stalls, 0)
})

test('recordProgress: increments stalls when facts unchanged', () => {
  let p = newProgress()
  p = recordProgress(p, ['same'])
  p = recordProgress(p, ['same'])
  assert.equal(p.stalls, 1)
})

test('recordProgress: resets stalls when facts change', () => {
  let p = newProgress()
  p = recordProgress(p, ['a'])
  p = recordProgress(p, ['a'])
  p = recordProgress(p, ['b'])
  assert.equal(p.stalls, 0)
})

test('shouldReplan: triggers replan at maxStalls=2', () => {
  let p = newProgress()
  p = recordProgress(p, ['stuck'])
  p = recordProgress(p, ['stuck'])
  p = recordProgress(p, ['stuck'])
  assert.equal(shouldReplan(p), true)
})

test('shouldReplan: does not replan with 0 stalls', () => {
  assert.equal(shouldReplan(newProgress()), false)
})

test('confirmFact: moves fact from assumed to known', () => {
  const ledger = { known: [], assumed: ['X exists'], goal: 'test' }
  const updated = confirmFact(ledger, 'X exists')
  assert.ok(updated.known.includes('X exists'))
  assert.ok(!updated.assumed.includes('X exists'))
})
