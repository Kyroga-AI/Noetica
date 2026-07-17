/** grl-ope — Direct-Method offline policy evaluation: the shadow→active readiness gate. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluatePolicy } from './grl-ope.js'
import { featurizeGraphState, type GraphState } from './graph-state.js'
import type { Transition } from './grl-federation.js'

function lcg(seed: number) { let s = seed >>> 0; return () => (s = (1103515245 * s + 12345) >>> 0) / 0xffffffff }
const HI = featurizeGraphState({ epistemic: { verified: 8, observed: 2 }, subgraphSize: 10, edgeCount: 18, topNodeShare: 0.2, grounded: true, queryTokens: 12 })
const LO = featurizeGraphState({ epistemic: { hypothesis: 2 }, subgraphSize: 2, edgeCount: 1, topNodeShare: 0.8, grounded: false, queryTokens: 4 } as GraphState)
const ACTIONS = ['kb', 'vector-rag']

/** A logging (heuristic) policy that EXPLORES both actions in both contexts but is often suboptimal. */
function loggedRun(n: number, seed: number, explore = true): Transition[] {
  const rnd = lcg(seed); const out: Transition[] = []
  for (let i = 0; i < n; i++) {
    const hi = rnd() < 0.5
    const context = hi ? HI : LO
    const best = hi ? 'kb' : 'vector-rag'
    // heuristic: 55% best, else the other (so both actions have support in both buckets)
    const action = rnd() < 0.55 ? best : (explore ? (hi ? 'vector-rag' : 'kb') : best)
    const trueBest = hi ? 'kb' : 'vector-rag'
    const reward = Math.max(0, Math.min(1, (action === trueBest ? 0.9 : 0.2) + (rnd() - 0.5) * 0.1))
    out.push({ action, context, reward })
  }
  return out
}

test('READY: learned policy beats the heuristic on validated traffic → flip is justified', () => {
  const r = evaluatePolicy(loggedRun(600, 7), { actions: ACTIONS })
  assert.ok(r.supportedFraction >= 0.8, `support ${r.supportedFraction}`)   // both actions explored → validatable
  assert.ok(r.lift > 0, `lift ${r.lift}`)                                    // learned > heuristic
  assert.equal(r.readyToFlip, true, r.reason)
})

test('NOT READY: thin data → gate refuses to flip', () => {
  const r = evaluatePolicy(loggedRun(50, 3), { actions: ACTIONS })
  assert.equal(r.readyToFlip, false)
  assert.match(r.reason, /insufficient data/)
})

test('NOT READY: heuristic never explored the alternative → under-validated', () => {
  // explore=false → the log only ever contains the heuristic's own (best) action, so the learned policy's
  // choices are supported... but if the learned policy would pick a DIFFERENT action, no support exists.
  // Here we force a log with a SINGLE action so any deviation is unvalidatable.
  const single: Transition[] = loggedRun(400, 9, false).map((t) => ({ ...t, action: 'kb' }))
  const r = evaluatePolicy(single, { actions: ['kb', 'vector-rag', 'web+vector'], minLiftPct: 50 })
  // learned may prefer an unexplored action in some bucket → support < 1, and/or lift under threshold
  assert.equal(r.readyToFlip, false)
})

test('result shape is complete + honest', () => {
  const r = evaluatePolicy(loggedRun(300, 1), { actions: ACTIONS })
  for (const k of ['transitions', 'buckets', 'loggedValue', 'learnedValue', 'lift', 'liftPct', 'supportedFraction', 'readyToFlip', 'reason']) {
    assert.ok(k in r, `missing ${k}`)
  }
})
