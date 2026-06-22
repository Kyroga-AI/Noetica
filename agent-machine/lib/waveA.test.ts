/** Wave-3 Batch A — advanced reasoning: reasoning-modes, step-verify, planner-executor, blackboard, checkpoint. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { budgetStep, toDraft, draftChain } from './reasoning-modes.js'
import { stepValue, stepBeamSearch, type Step } from './step-verify.js'
import { newProgress, recordProgress, shouldReplan, confirmFact } from './planner-executor.js'
import { Blackboard } from './blackboard.js'
import { newCheckpoint, recordStep, remainingSteps, isComplete } from './checkpoint.js'

test('reasoning-modes: budget-forcing bands + chain-of-draft compression', () => {
  assert.equal(budgetStep(10, 100), 'continue', 'below min-think → continue')
  assert.equal(budgetStep(90, 100), 'wait', 'upper band → one more self-check')
  assert.equal(budgetStep(100, 100), 'stop', 'at budget → stop')
  assert.equal(toDraft('we should carefully consider all of the available options here', 4), 'we should carefully consider')
  assert.equal(draftChain(['a b c d e', '']).length, 1)
})

test('step-verify: rollout value + step-beam keeps best paths', () => {
  assert.equal(stepValue([true, true, false, false]), 0.5)
  const start: Step[] = [{ text: 'root', score: 0 }]
  const paths = stepBeamSearch(start, (p) => (p.length < 3 ? [{ text: 'good', score: 1 }, { text: 'bad', score: -1 }] : []), (p) => p.reduce((s, x) => s + x.score, 0), { beam: 1, depth: 3 })
  assert.equal(paths[0]!.every((s) => s.text !== 'bad' || s.score === 0), true, 'beam pruned the bad branch')
})

test('planner-executor: stall counter triggers replan; confirm promotes fact', () => {
  let prog = newProgress()
  prog = recordProgress(prog, ['a'])
  prog = recordProgress(prog, ['a'])     // no change → stall 1
  prog = recordProgress(prog, ['a'])     // stall 2
  assert.equal(shouldReplan(prog, 2), true)
  prog = recordProgress(prog, ['a', 'b'])// progress → reset
  assert.equal(prog.stalls, 0)
  const led = confirmFact({ known: [], assumed: ['x'], goal: 'g' }, 'x')
  assert.deepEqual(led.known, ['x']); assert.deepEqual(led.assumed, [])
})

test('blackboard: keyed writes, versioning, history, snapshot', () => {
  const b = new Blackboard()
  b.write('plan', 'v1', 'lead'); b.write('plan', 'v2', 'worker')
  assert.equal(b.read('plan'), 'v2')
  assert.equal(b.version('plan'), 2)
  assert.equal(b.history('plan').length, 2)
  assert.deepEqual(b.snapshot(), { plan: 'v2' })
})

test('checkpoint: resume skips completed steps', () => {
  let cp = newCheckpoint('run1')
  cp = recordStep(cp, 's1', { x: 1 })
  cp = recordStep(cp, 's1')              // idempotent
  assert.equal(cp.completed.length, 1)
  assert.deepEqual(remainingSteps(cp, ['s1', 's2', 's3']), ['s2', 's3'])
  assert.equal(isComplete(recordStep(recordStep(cp, 's2'), 's3'), ['s1', 's2', 's3']), true)
})
