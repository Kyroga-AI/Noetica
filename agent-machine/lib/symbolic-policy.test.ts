import { test } from 'node:test'
import assert from 'node:assert'
import { computeReward, fitPolicy } from './symbolic-policy.js'
import type { TurnRecord } from './dialogue-tracker.js'

test('reward penalizes latency and rewards grounding', () => {
  const fast = computeReward({ worth: 0.8, latencyMs: 3_000, grounded: true, fillRate: 1 })
  const slow = computeReward({ worth: 0.8, latencyMs: 155_000, grounded: true, fillRate: 1 })
  assert.ok(fast > slow, `fast (${fast}) should beat slow (${slow}) at equal quality`)
  const ungrounded = computeReward({ worth: 0.8, latencyMs: 3_000, grounded: false, fillRate: 1 })
  assert.ok(fast > ungrounded, 'grounding should raise reward')
})

function rec(p: Partial<TurnRecord>): TurnRecord {
  return {
    session_id: 's', turn: 0, ts: '', intent: 'x', intent_score: 2, fallback: false,
    slots_expected: ['a'], slots_filled: [], fill_rate: 1, clarified: false, entities: [],
    surface: '', skill: '', tools: [], capability: 'general', model: 'm', retrieval: 'kb',
    grounded: true, latency_ms: 5000, worth: 0.8, reward: 0.5, ...p,
  }
}

test('fit recovers latency as a negative driver', () => {
  // Build a log where reward tracks (grounded − latency_norm): the fit should learn
  // latency_norm pushes reward DOWN and grounded pushes it UP.
  const recs: TurnRecord[] = []
  for (let i = 0; i < 40; i++) {
    const grounded = i % 2 === 0
    const latency = (i % 5) * 8000
    const reward = Math.max(0, Math.min(1, 0.5 + (grounded ? 0.3 : -0.3) - (latency / 30000) * 0.4))
    recs.push(rec({ grounded, latency_ms: latency, reward }))
  }
  const fit = fitPolicy(recs)
  assert.ok(fit, 'should fit with ≥8 samples')
  assert.ok(fit!.coefficients.latency_norm < 0, `latency should be negative driver, got ${fit!.coefficients.latency_norm}`)
  assert.ok(fit!.coefficients.grounded > 0, `grounded should be positive driver, got ${fit!.coefficients.grounded}`)
  assert.ok(fit!.r2 > 0.5, `should fit reasonably, R²=${fit!.r2}`)
})

test('returns null below the honesty threshold', () => {
  assert.equal(fitPolicy([rec({}), rec({})]), null)
})
