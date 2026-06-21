import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractCode, extractFinalAnswer, normalizeAnswer, programOfThought, candidateAgreesWithVerified, pickRunnableLanguage, testsPassed, codeVerifyRepair } from './exec-verify.js'

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

test('pickRunnableLanguage: python default, js when asked, abstain on unrunnable', () => {
  assert.equal(pickRunnableLanguage('write a function to reverse a string'), 'python')
  assert.equal(pickRunnableLanguage('write a javascript function to debounce'), 'javascript')
  assert.equal(pickRunnableLanguage('write a Rust function for quicksort'), null)
  assert.equal(pickRunnableLanguage('refactor this TypeScript module'), null)
})

test('testsPassed needs the marker AND no error trace', () => {
  assert.equal(testsPassed('running...\nALL_TESTS_PASSED'), true)
  assert.equal(testsPassed('AssertionError: 1 != 2\nALL_TESTS_PASSED'), false)
  assert.equal(testsPassed('done'), false)
})

test('codeVerifyRepair returns the passing solution on first try', async () => {
  const cv = await codeVerifyRepair('write a function is_even', {
    generate: async () => '```python\ndef is_even(n): return n%2==0\nassert is_even(4)\nassert not is_even(3)\nprint("ALL_TESTS_PASSED")\n```',
    execute: async () => 'ALL_TESTS_PASSED',
  })
  assert.ok(cv)
  assert.equal(cv!.passed, true)
  assert.equal(cv!.attempts, 1)
})

test('codeVerifyRepair repairs after a failing first attempt', async () => {
  let call = 0
  const cv = await codeVerifyRepair('write a function add1', {
    generate: async () => {
      call++
      return call === 1
        ? '```python\ndef add1(n): return n+2\nassert add1(1)==2\nprint("ALL_TESTS_PASSED")\n```'   // buggy
        : '```python\ndef add1(n): return n+1\nassert add1(1)==2\nprint("ALL_TESTS_PASSED")\n```'   // fixed
    },
    execute: async (_l, code) => (code.includes('n+1') ? 'ALL_TESTS_PASSED' : 'AssertionError\n'),
  }, 1)
  assert.ok(cv)
  assert.equal(cv!.passed, true)
  assert.equal(cv!.attempts, 2)
})

test('codeVerifyRepair abstains (null) for an unrunnable language', async () => {
  const cv = await codeVerifyRepair('write a Rust quicksort', { generate: async () => '```rust\nfn main(){}\n```', execute: async () => '' })
  assert.equal(cv, null)
})
