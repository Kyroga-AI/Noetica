import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planTurn, CapacityGate } from './orchestrator.js'

test('planTurn: small-talk + self-questions are answered inline by the concierge', () => {
  assert.equal(planTurn('hey there').mode, 'direct')
  assert.equal(planTurn('thanks!').mode, 'direct')
  assert.equal(planTurn('how do you work?').mode, 'direct') // self-model
  assert.equal(planTurn('which repos build you?').mode, 'direct')
})

test('planTurn: heavy work is dispatched with an acknowledgement', () => {
  const research = planTurn('research the latest salary data for data scientists in NYC pharma')
  assert.equal(research.mode, 'dispatch')
  assert.equal(research.capability, 'research')
  assert.ok(research.ack && /research this for you/i.test(research.ack))

  const reasoning = planTurn('prove that the sum of the first n odd numbers is n squared, step by step')
  assert.equal(reasoning.mode, 'dispatch')
  assert.equal(reasoning.capability, 'reasoning')

  const code = planTurn('refactor this typescript function to remove the bug')
  assert.equal(code.mode, 'dispatch')
  assert.equal(code.capability, 'code')
})

test('CapacityGate serializes at capacity 1 and preserves FIFO order', async () => {
  const gate = new CapacityGate(1)
  const order: number[] = []
  const mk = (id: number, ms: number) => gate.run(async () => {
    await new Promise((r) => setTimeout(r, ms))
    order.push(id)
    return id
  })
  // Submit three; with capacity 1 they must complete in submission order.
  const p1 = mk(1, 30)
  const p2 = mk(2, 5)
  const p3 = mk(3, 5)
  // While 1 runs, 2 and 3 are queued.
  assert.equal(gate.status.active, 1)
  assert.ok(gate.status.queued >= 1)
  await Promise.all([p1, p2, p3])
  assert.deepEqual(order, [1, 2, 3], 'FIFO despite shorter later jobs')
  assert.deepEqual(gate.status, { capacity: 1, active: 0, queued: 0 })
})

test('CapacityGate reports queue position', () => {
  const gate = new CapacityGate(1)
  assert.equal(gate.nextQueuePosition, 0) // empty → runs now
})
