import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEvalCases, selectForReplay, replayCase, summarizeReplay } from './eval-replay.js'

const line = (input: string, mode = 'ungrounded', cov = 0.3, at = 1) =>
  JSON.stringify({ input, output: 'x', failureMode: mode, coverage: cov, capturedAt: at })

test('parseEvalCases tolerates blank/malformed/inputless lines', () => {
  const text = `${line('a')}\n\n{bad json\n${JSON.stringify({ output: 'no input' })}\n${line('b')}`
  const cases = parseEvalCases(text)
  assert.equal(cases.length, 2)
  assert.deepEqual(cases.map((c) => c.input), ['a', 'b'])
})

test('selectForReplay is most-recent-first, deduped, capped', () => {
  const cases = parseEvalCases([line('q1', 'ungrounded', 0.3, 1), line('Q1', 'ungrounded', 0.3, 2), line('q2', 'ungrounded', 0.3, 3)].join('\n'))
  const sel = selectForReplay(cases, 10)
  assert.equal(sel.length, 2)                       // q1/Q1 collapse
  assert.equal(sel[0]!.input, 'q2')                 // most recent first
  assert.equal(selectForReplay(cases, 1).length, 1) // cap honored
})

test('replayCase marks fixed only when it now grounds', async () => {
  const c = parseEvalCases(line('why is the sky blue'))[0]!
  const regen = async () => ({ answer: 'grounded answer', sources: [{ text: 'ctx' }] })
  const fixed = await replayCase(c, regen, () => ({ grounded: true, score: 0.9 }))
  assert.equal(fixed.fixed, true)
  const still = await replayCase(c, regen, () => ({ grounded: false, score: 0.2 }))
  assert.equal(still.fixed, false)
  // a regeneration error → still failing, never throws
  const errored = await replayCase(c, async () => { throw new Error('model down') }, () => ({ grounded: true, score: 1 }))
  assert.equal(errored.fixed, false)
})

test('summarizeReplay computes the felt-win numbers', () => {
  const s = summarizeReplay(
    [
      { input: 'a', failureMode: 'ungrounded', priorCoverage: 0.2, nowGrounded: true, nowScore: 0.9, fixed: true },
      { input: 'b', failureMode: 'thin-coverage', priorCoverage: 0.4, nowGrounded: false, nowScore: 0.3, fixed: false },
      { input: 'c', failureMode: 'ungrounded', priorCoverage: 0.1, nowGrounded: true, nowScore: 0.8, fixed: true },
    ],
    1000,
  )
  assert.equal(s.total, 3)
  assert.equal(s.fixed, 2)
  assert.equal(s.stillFailing, 1)
  assert.equal(Math.round(s.fixedRate * 100), 67)
})
