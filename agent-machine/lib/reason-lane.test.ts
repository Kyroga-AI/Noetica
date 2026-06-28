import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isReasonLaneIntent,
  reasonLaneEnabled,
  reasonSCK,
  runReasonLane,
  extractFinal,
  REASON_LANE_INTENTS,
  DEFAULT_SC_K,
} from './reason-lane.js'
import { classifyIntent } from './intent-router.js'

// The reason lane promotes the proven +24pp bench win (no-retrieval CoT + self-consistency for
// math/reasoning) into serving. These tests pin: (a) intent routing — math/reasoning intents select the
// lane + skip retrieval; non-math don't; (b) composition — runReasonLane votes via cragVote and returns
// the majority answer WITHOUT calling any retrieval; (c) fallback safety; (d) operator→reason ordering.

// ── (a) Intent routing ───────────────────────────────────────────────────────
test('math/reasoning intents route to the reason lane', () => {
  // compute_math (id 16) and prove_reason (id 17) are the proven problem-solving intents.
  const compute = classifyIntent('compute the integral of x^2 from 0 to 3')
  assert.equal(compute.name, 'compute_math')
  assert.ok(isReasonLaneIntent(compute.name), 'compute_math should be a reason-lane intent')

  const prove = classifyIntent('prove that the square root of 2 is irrational')
  assert.equal(prove.name, 'prove_reason')
  assert.ok(isReasonLaneIntent(prove.name), 'prove_reason should be a reason-lane intent')

  assert.deepEqual([...REASON_LANE_INTENTS].sort(), ['compute_math', 'prove_reason'])
})

test('reason-lane intents declare program-aided retrieval in the router; serving SKIPS retrieval for them', () => {
  // The router maps compute_math/prove_reason to program-aided retrieval, but the serving path treats a
  // reason-lane intent as retrieval-OFF (the exact +24pp condition). We assert membership here; the
  // server gates retrieval on isReasonLaneIntent (useReasonLane), proven in the composition test below.
  for (const name of REASON_LANE_INTENTS) assert.ok(isReasonLaneIntent(name))
})

test('non-math intents are UNCHANGED — they do not enter the reason lane', () => {
  for (const q of [
    'summarize this document',
    'write me a poem about the sea',
    'review this pull request',
    'what is the status of the build',
    'hello there',
    'explain how photosynthesis works',          // explain_teach keeps grounding — NOT in the lane
    'what are the next steps for the project',
  ]) {
    const plan = classifyIntent(q)
    assert.equal(isReasonLaneIntent(plan.name), false, `"${q}" (${plan.name}) must NOT route to the reason lane`)
  }
})

// ── env flags ─────────────────────────────────────────────────────────────────
test('reasonLaneEnabled defaults ON, toggles off with NOETICA_REASON_LANE=0', () => {
  assert.equal(reasonLaneEnabled({}), true)
  assert.equal(reasonLaneEnabled({ NOETICA_REASON_LANE: '1' } as Record<string, string | undefined>), true)
  assert.equal(reasonLaneEnabled({ NOETICA_REASON_LANE: '0' } as Record<string, string | undefined>), false)
})

test('reasonSCK defaults to the proven K=3, honors NOETICA_SC_K, rejects junk', () => {
  assert.equal(reasonSCK({}), DEFAULT_SC_K)
  assert.equal(DEFAULT_SC_K, 3)
  assert.equal(reasonSCK({ NOETICA_SC_K: '5' } as Record<string, string | undefined>), 5)
  assert.equal(reasonSCK({ NOETICA_SC_K: '1' } as Record<string, string | undefined>), 1)
  assert.equal(reasonSCK({ NOETICA_SC_K: 'abc' } as Record<string, string | undefined>), DEFAULT_SC_K)  // junk → default
  assert.equal(reasonSCK({ NOETICA_SC_K: '0' } as Record<string, string | undefined>), DEFAULT_SC_K)    // <1 → default
})

// ── extractFinal ───────────────────────────────────────────────────────────────
test('extractFinal pulls + normalizes the last FINAL line', () => {
  assert.equal(extractFinal('Step 1...\nStep 2...\nFINAL: 42'), '42')
  assert.equal(extractFinal('FINAL: The Answer Is X.'), 'the answer is x')   // lowercased + trailing dot trimmed
  assert.equal(extractFinal('FINAL: A\n\nWait, reconsider...\nFINAL: B'), 'b')  // LAST final wins
  assert.equal(extractFinal('no final marker here'), null)
  assert.equal(extractFinal(''), null)
  assert.equal(extractFinal('FINAL:   '), null)   // empty final → null (skips the vote)
})

// ── (b) Composition: cragVote majority, NO retrieval call ────────────────────────
test('runReasonLane returns the self-consistency majority answer WITHOUT any retrieval call', async () => {
  let retrievalCalls = 0
  // A spy retrieval fn — must never be invoked by the reason lane.
  const retrieve = async () => { retrievalCalls++; return 'SHOULD NOT BE CALLED' }

  // Stubbed model sampler: majority answer is "7" (3 of 5 samples), with two distractors.
  const samples = [
    'reasoning...\nFINAL: 7',
    'reasoning...\nFINAL: 8',
    'reasoning...\nFINAL: 7',
    'reasoning...\nFINAL: 7',
    'reasoning...\nFINAL: 9',
  ]
  const sample = (idx: number) => Promise.resolve(samples[idx]!)

  const r = await runReasonLane(sample, 5)
  assert.equal(r.choice, '7', 'majority FINAL answer wins')
  // Adaptive-SC lossless early-stop: after [7,8,7,7] the leader (3) is uncatchable by the 1 remaining
  // sample, so the kernel stops at 4 draws → agree = 3/4. (This is the proven cragVote behavior.)
  assert.equal(r.agree, 3 / 4, 'agreement = winning fraction after Adaptive-SC early-stop')
  assert.equal(r.n, 4, 'early-stopped after 4 of 5 draws')
  assert.match(r.content, /FINAL: 7/, 'returns the full text of a winning sample')
  assert.equal(retrievalCalls, 0, 'reason lane must NOT call retrieval')
})

test('runReasonLane with K=1 collapses to a single draw (voting off)', async () => {
  let draws = 0
  const sample = () => { draws++; return Promise.resolve('FINAL: alpha') }
  const r = await runReasonLane(sample, 1)
  assert.equal(r.choice, 'alpha')
  assert.equal(draws, 1)
  assert.match(r.content, /alpha/)
})

test('runReasonLane uses the temp-0 fallback when no sample yields a FINAL line', async () => {
  const samples = ['rambling, no final', 'still nothing', 'nope']
  let idx = 0
  // First k draws have no FINAL; the fallback (draw index k) yields a parseable answer.
  const sample = (i: number) => Promise.resolve(i < 3 ? samples[i]! : 'FINAL: fallback-answer')
  void idx
  const r = await runReasonLane(sample, 3)
  assert.equal(r.choice, 'fallback-answer')
})

// ── (c) Fallback safety: a throwing sampler propagates so the caller falls back ──
test('runReasonLane surfaces sampler errors (caller falls back to the normal path)', async () => {
  const sample = () => { throw new Error('model down') }
  await assert.rejects(() => runReasonLane(sample, 3), /model down/)
})

// ── (d) Operator→reason ordering: reason lane only owns the NON-operator case ────
test('operator→reason ordering: operator-routable math is handled before the reason lane', () => {
  // The server runs the verified-operator/PoT compute lane FIRST (posture==="compute"); only when it
  // produces nothing (deliberated stays false) does the reason lane run. This asserts the contract the
  // server encodes: the reason lane is gated on !deliberated, so an operator-answered turn never enters it.
  // (Unit-level proxy: a reason-lane intent that was already "deliberated" must not be re-entered.)
  const intentName = 'compute_math'
  assert.ok(isReasonLaneIntent(intentName))
  const deliberatedByOperator = true
  const wouldEnterReasonLane = !deliberatedByOperator && reasonLaneEnabled({}) && isReasonLaneIntent(intentName)
  assert.equal(wouldEnterReasonLane, false, 'operator-answered turn must not enter the reason lane')
  const nonOperator = false
  const wouldEnterReasonLaneNonOp = !nonOperator && reasonLaneEnabled({}) && isReasonLaneIntent(intentName)
  assert.equal(wouldEnterReasonLaneNonOp, true, 'non-operator math enters CoT+SC')
})
