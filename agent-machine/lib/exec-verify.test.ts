import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as cp from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { extractCode, extractFinalAnswer, normalizeAnswer, programOfThought, operatorProgramOfThought, OPERATOR_API, candidateAgreesWithVerified, pickRunnableLanguage, testsPassed, codeVerifyRepair } from './exec-verify.js'

// Locate agent-machine/lib (where math_operators.py lives) from the test's cwd — the suite runs
// from agent-machine/, so 'lib' resolves; cover the repo-root launch too.
const HERE = [path.join(process.cwd(), 'lib'), path.join(process.cwd(), 'agent-machine', 'lib')]
  .find((d) => fs.existsSync(path.join(d, 'math_operators.py'))) ?? path.join(process.cwd(), 'lib')

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

test('OPERATOR_API offers the verified library menu (mirrors the bench)', () => {
  for (const op of ['permutation_index', 'finite_field_zeros', 'mod_pow', 'linear_ode_eval']) {
    assert.ok(OPERATOR_API.includes(op), `operator menu should advertise ${op}`)
  }
})

test('operatorProgramOfThought routes to the verified library and returns the gold answer (wiring proof, stubbed execute)', async () => {
  // Force the model to "select" the permutation_index operator + extract args; prove the wiring
  // executes the verified library and returns the exact result — no live LLM, no real subprocess.
  const op = await operatorProgramOfThought('In S_5, the cyclic permutation (1 2 5 4)(2 3) has index?', '/fake/lib', {
    generate: async () => '```python\nfrom math_operators import permutation_index\nprint(permutation_index("(1,2,5,4)(2,3)", 5))\n```',
    // Stub the sandbox: the wrapped code prepends sys.path.insert; we assert it imports + returns gold (24).
    execute: async (_lang, code) => {
      assert.match(code, /sys\.path\.insert\(0, "\/fake\/lib"\)/)
      assert.match(code, /from math_operators import permutation_index/)
      return '24'
    },
  })
  assert.ok(op)
  assert.equal(op!.answer, '24')
  assert.equal(op!.usedOperator, true)
})

test('operatorProgramOfThought flags usedOperator=false when the model writes cold code (cold-fallback signal)', async () => {
  const op = await operatorProgramOfThought('what is 2+2', '/fake/lib', {
    generate: async () => '```python\nprint(2 + 2)\n```',
    execute: async () => '4',
  })
  assert.ok(op)
  assert.equal(op!.usedOperator, false)   // server only accepts usedOperator=true; else falls to cold PoT
})

test('operatorProgramOfThought executes the REAL math_operators.py end-to-end (gold answer)', async () => {
  // True end-to-end: real python3 subprocess importing the actual verified library on disk.
  // Mirrors the bench's execution mechanism exactly (sys.path.insert + import + print last line).
  const op = await operatorProgramOfThought('index of (1,2,5,4)(2,3) in S_5', HERE, {
    generate: async () => '```python\nfrom math_operators import permutation_index\nprint(permutation_index("(1,2,5,4)(2,3)", 5))\n```',
    execute: async (_lang, code) => {
      try { return cp.execFileSync('python3', ['-c', code], { encoding: 'utf8', timeout: 20_000 }) }
      catch (e) { return (e as { stdout?: Buffer | string })?.stdout?.toString() ?? 'EXEC_FAILED' }
    },
  })
  assert.ok(op)
  assert.equal(op!.usedOperator, true)
  assert.equal(op!.answer, '24')   // exact gold, computed by the verified library
})

test('operatorProgramOfThought returns null when the program errors (caller falls back to cold PoT)', async () => {
  const op = await operatorProgramOfThought('broken', '/fake/lib', {
    generate: async () => '```python\nfrom math_operators import nope\nprint(nope())\n```',
    execute: async () => 'Traceback (most recent call last):\nImportError: cannot import name nope',
  })
  assert.equal(op, null)
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

test('codeVerifyRepair falls back to a clean baseline when tests never pass (promote-never-demote)', async () => {
  let call = 0
  const cv = await codeVerifyRepair('write a function f', {
    generate: async () => {
      call++
      // first maxRepairs+1 calls = solution+tests that never pass; final call = baseline.
      return call <= 2
        ? '```python\ndef f(n): return n\nassert f(1)==2\nprint("ALL_TESTS_PASSED")\n```'
        : '```python\ndef f(n): return n + 1\n```'  // clean baseline (no self-tests)
    },
    execute: async () => 'AssertionError\n',   // self-tests always fail
  }, 1)
  assert.ok(cv)
  assert.equal(cv!.passed, false)
  assert.match(cv!.solution, /return n \+ 1/)   // the clean baseline, NOT the failing attempt
  assert.ok(!cv!.solution.includes('ALL_TESTS_PASSED'))
})

test('codeVerifyRepair abstains (null) for an unrunnable language', async () => {
  const cv = await codeVerifyRepair('write a Rust quicksort', { generate: async () => '```rust\nfn main(){}\n```', execute: async () => '' })
  assert.equal(cv, null)
})
