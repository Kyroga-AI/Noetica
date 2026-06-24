import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchDialogue } from './dialogue'

// matchDialogue returns null when the deterministic layer should NOT handle it (→ falls through to the model).
const is8ball = (s: string) => /🎱/.test(matchDialogue(s)?.reply ?? '')

test('a genuine "will it…" question is NOT hijacked by the magic-8-ball', () => {
  // The exact phrasing that mis-fired in the live app.
  assert.equal(matchDialogue('will it run here or where'), null, 'a real question must fall through to the model')
  assert.equal(is8ball('will it run here or where'), false)
  // Other real technical questions that the old `will (it|i|this).*` pattern wrongly 8-balled:
  for (const q of ['will it work', 'will it run on linux', 'will this scale', 'will i need docker']) {
    assert.equal(is8ball(q), false, `"${q}" should reach the model, not the 8-ball`)
  }
})

test('any info-question (where/what/how/…) is never 8-balled', () => {
  for (const q of ['should i use postgres or where does it store data', 'is it a good idea and how do i start']) {
    assert.equal(is8ball(q), false, `"${q}" contains a question word → model`)
  }
})

test('explicit 8-ball / decision novelty still works', () => {
  assert.equal(is8ball('magic 8 ball'), true)
  assert.equal(is8ball('should i buy bitcoin'), true)
  assert.equal(is8ball('decide for me'), true)
  assert.equal(is8ball('yes or no'), true)
})
