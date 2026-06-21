import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractCode, extractFinalAnswer, normalizeAnswer, programOfThought, candidateAgreesWithVerified } from './exec-verify.js'

test('extractCode pulls a fenced python block', () => {
  assert.equal(extractCode('Here:\n```python\nprint(2+2)\n```\ndone'), 'print(2+2)')
})

test('extractCode accepts bare code that looks like code', () => {
  assert.equal(extractCode('x = 5\nprint(x*2)'), 'x = 5\nprint(x*2)')
})

test('extractCode returns null for prose', () => {
  assert.equal(extractCode('The answer is probably 27, I think.'), null)
})

test('extractFinalAnswer takes the last meaningful line, skipping sandbox noise', () => {
  assert.equal(extractFinalAnswer('$ python\n[workspace: default exit: 0]\n27'), '27')
  assert.equal(extractFinalAnswer('computing...\n31'), '31')
})

test('normalizeAnswer compares numbers regardless of formatting', () => {
  assert.equal(normalizeAnswer('1,234.0'), normalizeAnswer('1234'))
  assert.equal(normalizeAnswer('  $40 '), '40')
})

test('programOfThought executes generated code and returns the verified answer', async () => {
  // Fake deps: the "model" emits a correct program; the "sandbox" really runs nothing —
  // we simulate the output. (Real wiring uses Ollama + the code sandbox.)
  const pot = await programOfThought('A store has 23 apples, sells 7, gets 15 more. How many?', {
    generate: async () => '```python\nprint(23 - 7 + 15)\n```',
    execute: async (_lang, code) => (code.includes('23 - 7 + 15') ? '31' : 'wrong'),
  })
  assert.ok(pot)
  assert.equal(pot!.answer, '31')
})

test('programOfThought returns null when no runnable program is produced', async () => {
  const pot = await programOfThought('hard question', {
    generate: async () => 'I think the answer is around forty-ish.',
    execute: async () => 'unused',
  })
  assert.equal(pot, null)
})

test('candidateAgreesWithVerified matches a natural-language answer to the verified number', () => {
  assert.equal(candidateAgreesWithVerified('After selling and restocking, there are 31 apples.', '31'), true)
  assert.equal(candidateAgreesWithVerified('I believe the total is 33 pencils.', '27'), false)
})
