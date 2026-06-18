import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectGoalIntent, slotFill, goalProgress, buildGoalContext, type Goal } from './goal-model.js'

test('detectGoalIntent fires on explicit goal phrasing', () => {
  assert.deepEqual(detectGoalIntent('I want to migrate the database to Postgres'), { objective: 'migrate the database to Postgres' })
  assert.equal(detectGoalIntent('my goal is to ship the demo')?.objective, 'ship the demo')
  assert.equal(detectGoalIntent('help me write a resignation letter')?.objective, 'write a resignation letter')
})

test('detectGoalIntent ignores ordinary messages', () => {
  assert.equal(detectGoalIntent('what time is it?'), null)
  assert.equal(detectGoalIntent('thanks, that works'), null)
})

test('slotFill marks a slot filled when its name is mentioned', () => {
  const slots = [{ name: 'deadline', filled: false }, { name: 'budget', filled: false }]
  const after = slotFill(slots, 'the deadline is next Friday')
  assert.equal(after.find((s) => s.name === 'deadline')!.filled, true)
  assert.equal(after.find((s) => s.name === 'budget')!.filled, false)
})

test('goalProgress counts subtasks and open slots', () => {
  const g: Goal = {
    id: 'g1', session_id: 's', objective: 'x', status: 'active',
    subtasks: [{ title: 'a', done: true }, { title: 'b', done: false }],
    slots: [{ name: 'deadline', filled: true }, { name: 'budget', filled: false }],
    created_at: '', updated_at: '',
  }
  const p = goalProgress(g)
  assert.equal(p.subtasksDone, 1)
  assert.equal(p.subtasksTotal, 2)
  assert.deepEqual(p.openSlots, ['budget'])
})

test('buildGoalContext surfaces objective, plan, and open slots', () => {
  const g: Goal = {
    id: 'g1', session_id: 's', objective: 'ship the demo', status: 'active',
    subtasks: [{ title: 'write tests', done: true }, { title: 'record video', done: false }],
    slots: [{ name: 'audience', filled: false }],
    created_at: '', updated_at: '',
  }
  const ctx = buildGoalContext(g)
  assert.match(ctx, /Active goal.*ship the demo/)
  assert.match(ctx, /1\/2 done/)
  assert.match(ctx, /Still needed: audience/)
})
