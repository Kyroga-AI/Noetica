import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  runSearchVerify,
  searchVerifyEnabled,
  extractCandidate,
  candidatePrompt,
  type VerifyResult,
} from './search-verify.js'

// Pure unit tests: NO model, NO sandbox. The sampler + verify are stubbed so the
// generate→verify→retry loop is exercised deterministically.

const cot = (final: string) => `Let me reason about this.\nStep one.\nFINAL: ${final}`

test('searchVerifyEnabled: default ON, =0 disables', () => {
  assert.equal(searchVerifyEnabled({}), true)
  assert.equal(searchVerifyEnabled({ NOETICA_SEARCH_VERIFY: '1' }), true)
  assert.equal(searchVerifyEnabled({ NOETICA_SEARCH_VERIFY: '0' }), false)
})

test('extractCandidate: pulls the FINAL value, falls back to last line', () => {
  assert.equal(extractCandidate(cot('42')), '42')
  assert.equal(extractCandidate('no marker here\njust a tail'), 'just a tail')
  assert.equal(extractCandidate('   \n  '), null)
})

test('candidatePrompt: folds prior failure into the retry prompt', () => {
  const p0 = candidatePrompt('find the smallest x')
  assert.match(p0, /step by step/i)
  assert.doesNotMatch(p0, /FAILED verification/)
  const p1 = candidatePrompt('find the smallest x', 'x=3 does not satisfy x>5')
  assert.match(p1, /FAILED verification/)
  assert.match(p1, /x=3 does not satisfy x>5/)
})

test('(a) candidate verifies first try → returned with verified:true', async () => {
  let samples = 0
  const res = await runSearchVerify({
    question: 'find an x such that x>5',
    sample: async () => { samples++; return cot('7') },
    verify: async (): Promise<VerifyResult> => ({ pass: true, mode: 'executable' }),
  })
  assert.ok(res)
  assert.equal(res!.verified, true)
  assert.equal(res!.candidate, '7')
  assert.equal(res!.attempts, 1)
  assert.equal(samples, 1, 'should not regenerate after a first-try pass')
})

test('(b) first fails, second passes → verify-guided retry returns the passing one', async () => {
  const seen: (string | undefined)[] = []
  let call = 0
  const res = await runSearchVerify({
    question: 'find x such that x>5',
    sample: async (_i, priorFailure) => { seen.push(priorFailure); return cot(call++ === 0 ? '3' : '9') },
    verify: async (candidate): Promise<VerifyResult> =>
      Number(candidate) > 5
        ? { pass: true, mode: 'executable' }
        : { pass: false, mode: 'executable', reason: `${candidate} does not satisfy x>5` },
  })
  assert.ok(res)
  assert.equal(res!.verified, true)
  assert.equal(res!.candidate, '9')
  assert.equal(res!.attempts, 2)
  // The retry must have received the first attempt's failure reason (verify-guided).
  assert.equal(seen[0], undefined)
  assert.match(String(seen[1]), /does not satisfy x>5/)
})

test('(c) none pass within maxAttempts → best candidate, verified:false, no throw', async () => {
  let samples = 0
  const res = await runSearchVerify({
    question: 'find x such that x>100',
    sample: async () => { samples++; return cot('1') },
    verify: async (): Promise<VerifyResult> => ({ pass: false, mode: 'executable', reason: 'too small' }),
    maxAttempts: 3,
  })
  assert.ok(res)
  assert.equal(res!.verified, false)
  assert.equal(res!.verifyMode, null)
  assert.equal(res!.candidate, '1')
  assert.equal(samples, 3, 'should exhaust maxAttempts')
})

test('(c2) a thrown verify is swallowed (treated as a miss), loop never throws', async () => {
  const res = await runSearchVerify({
    question: 'find x',
    sample: async () => cot('x'),
    verify: async () => { throw new Error('sandbox blew up') },
    maxAttempts: 2,
  })
  assert.ok(res)
  assert.equal(res!.verified, false)
})

test('(d) executable-verify pass → executable flag; model-judged pass → model flag', async () => {
  const exec = await runSearchVerify({
    question: 'find x',
    sample: async () => cot('5'),
    verify: async (): Promise<VerifyResult> => ({ pass: true, mode: 'executable' }),
  })
  assert.equal(exec!.verifyMode, 'executable', 'executable pass yields exact-quality flag')

  const judged = await runSearchVerify({
    question: 'construct a counterexample',
    sample: async () => cot('the set {1,2}'),
    verify: async (): Promise<VerifyResult> => ({ pass: true, mode: 'model', reason: 'YES, it satisfies' }),
  })
  assert.equal(judged!.verifyMode, 'model', 'model-judged pass yields best-effort flag')
})

test('returns null when no candidate is ever produced', async () => {
  const res = await runSearchVerify({
    question: 'find x',
    sample: async () => '   ',
    verify: async (): Promise<VerifyResult> => ({ pass: true, mode: 'executable' }),
    maxAttempts: 2,
  })
  assert.equal(res, null)
})
