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

// ── confidence-gated override (the agentkb1 board fix) ──────────────────────────
test('gate REJECTS a low-confidence teacher override of a confident student (the 13-hurt bug)', async () => {
  const deps: RefineDeps = {
    retrieve: () => [],
    // teacher wants to change the answer but is LESS confident than the student
    critique: () => ({ critique: 'try a regex instead', revisedAnswer: 'two-stage regex', confidence: 0.55 }),
  }
  const confidentStudent: StudentTrajectory = { ...student, confidence: 0.9 }
  const r = await teacherStudentRefine(confidentStudent, deps, { maxRounds: 2, overrideMargin: 0.1 })
  // override rejected → keep the student's answer
  assert.equal(r.finalAnswer, confidentStudent.answer)
  assert.equal(r.rounds[0]!.proposedChange, true)
  assert.equal(r.rounds[0]!.overrideAccepted, false)
  assert.equal(r.rounds[0]!.changed, false)
  assert.match(r.reason, /rejected by confidence gate/)
})

test('gate ACCEPTS a high-confidence teacher override of an unsure student', async () => {
  let n = 0
  const deps: RefineDeps = {
    retrieve: () => [],
    critique: () => (n++ === 0
      ? { critique: 'the escaper edit is wrong', revisedAnswer: 'two-stage regex', confidence: 0.95 }
      : { critique: 'good', revisedAnswer: 'two-stage regex', confidence: 0.95 }),  // round 2 no change → converge
  }
  const unsureStudent: StudentTrajectory = { ...student, confidence: 0.4 }
  const r = await teacherStudentRefine(unsureStudent, deps, { maxRounds: 3, overrideMargin: 0.1 })
  assert.equal(r.finalAnswer, 'two-stage regex')          // Δconf 0.55 ≥ 0.1 → accepted
  assert.equal(r.rounds[0]!.overrideAccepted, true)
})

test('studentSkill raises the bar: same Δconf that passed now fails (Skrynnik decay analog)', async () => {
  const deps: RefineDeps = {
    retrieve: () => [],
    critique: () => ({ critique: 'change it', revisedAnswer: 'alt', confidence: 0.7 }),
  }
  const s: StudentTrajectory = { ...student, confidence: 0.55 }  // Δconf = 0.15
  const lenient = await teacherStudentRefine(s, deps, { maxRounds: 1, overrideMargin: 0.1 })  // 0.15 ≥ 0.10 → accept
  assert.equal(lenient.rounds[0]!.overrideAccepted, true)
  const strict = await teacherStudentRefine(s, deps, { maxRounds: 1, overrideMargin: 0.1, studentSkill: 0.1 })  // need 0.20
  assert.equal(strict.rounds[0]!.overrideAccepted, false)       // 0.15 < 0.20 → rejected, student kept
  assert.equal(strict.finalAnswer, s.answer)
})

test('no confidences supplied → legacy accept-on-change (backward compatible)', async () => {
  const deps: RefineDeps = {
    retrieve: () => [],
    critique: () => ({ critique: 'x', revisedAnswer: 'changed' }),  // no confidence fields
  }
  const r = await teacherStudentRefine(student, deps, { maxRounds: 1, overrideMargin: 0.5 })
  assert.equal(r.rounds[0]!.overrideAccepted, true)   // gate inert without confidences
  assert.equal(r.finalAnswer, 'changed')
})
