import { test } from 'node:test'
import assert from 'node:assert/strict'
import { teacherStudentRefine, refinementChangedAnswer, type StudentTrajectory, type RefineDeps } from './teacher-critique.js'

const student: StudentTrajectory = {
  task: 'In Sphinx, attribute names ending with an underscore are over-escaped in HTML output. Fix.',
  steps: ['reason: the HTML backslash...', 'retrieve: adjusting Sphinx escape', 'patch attempt 0'],
  answer: 'patch the HTML escaper directly',
}

test('teacher refines once then CONVERGES when the answer stops changing', async () => {
  let calls = 0
  const deps: RefineDeps = {
    retrieve: (task, k) => { assert.ok(task.length > 0); assert.equal(k, 3); return ['micro-exp: two-stage regex for Sphinx escape'] },
    critique: () => {
      calls++
      // round 1: change the answer; round 2: leave it unchanged → converge
      return calls === 1
        ? { critique: 'use a two-stage regex, not a direct escaper edit', revisedAnswer: 'two-stage regex on the escaped output' }
        : { critique: 'looks correct', revisedAnswer: 'two-stage regex on the escaped output' }
    },
  }
  const r = await teacherStudentRefine(student, deps, { maxRounds: 5 })
  assert.equal(r.converged, true)
  assert.equal(r.rounds.length, 2)                              // stopped as soon as it settled, not 5
  assert.equal(r.finalAnswer, 'two-stage regex on the escaped output')
  assert.equal(refinementChangedAnswer(student, r), true)      // it improved on the student's first answer
  assert.equal(r.rounds[0]!.changed, true)
  assert.equal(r.rounds[1]!.changed, false)
})

test('bounded: a teacher that keeps changing the answer stops at maxRounds', async () => {
  let n = 0
  const deps: RefineDeps = {
    retrieve: () => [],
    critique: () => ({ critique: 'still not quite', revisedAnswer: `attempt ${n++}` }),
  }
  const r = await teacherStudentRefine(student, deps, { maxRounds: 3 })
  assert.equal(r.converged, false)
  assert.equal(r.rounds.length, 3)
  assert.match(r.reason, /maxRounds=3/)
})

test('convergence is whitespace/case/punctuation-insensitive (no churn on trivial rewording)', async () => {
  const deps: RefineDeps = {
    retrieve: () => [],
    critique: () => ({ critique: 'reworded only', revisedAnswer: '  Patch the HTML Escaper, directly.  ' }),
  }
  const r = await teacherStudentRefine(student, deps, { maxRounds: 4 })
  assert.equal(r.converged, true)
  assert.equal(r.rounds.length, 1)              // recognized as the same answer → no further rounds
  assert.equal(r.rounds[0]!.changed, false)
})

test('a teacher-pass exception never throws — keeps the student answer (best-effort)', async () => {
  const deps: RefineDeps = {
    retrieve: () => { throw new Error('experience store down') },
    critique: () => ({ critique: 'unreached', revisedAnswer: 'unreached' }),
  }
  const r = await teacherStudentRefine(student, deps, { maxRounds: 2 })
  assert.equal(r.finalAnswer, student.answer)
  assert.equal(r.converged, true)
  assert.match(r.rounds[0]!.critique, /teacher pass failed/)
})
