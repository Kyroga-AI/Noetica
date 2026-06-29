import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  distillExperience, isPromotableTrajectory, retrieveExperiences, renderExperiences, recordUse, successRate,
  type ReasoningExperience,
} from './procedural-memory.js'

// ── the STRICT gate: only verified, replayable trajectories may be promoted ──────
test('isPromotableTrajectory: answer + (exact|best-effort) only', () => {
  assert.equal(isPromotableTrajectory('answer', 'exact'), true)
  assert.equal(isPromotableTrajectory('answer', 'best-effort'), true)
  // fail-closed cases
  assert.equal(isPromotableTrajectory('escalate', 'exact'), false)        // gate didn't trust it
  assert.equal(isPromotableTrajectory('answer', 'evidence-only'), false)  // observation, not reasoning
  assert.equal(isPromotableTrajectory('answer', 'non-replayable-side-effect'), false)
  assert.equal(isPromotableTrajectory(undefined, undefined), false)
  assert.equal(isPromotableTrajectory(null, null), false)
})

test('distillExperience DROPS an un-gated trajectory (fail-closed), keeps a gated one', () => {
  const base = { task: 'find eigenvalues of D', steps: ['retrieve operator', 'apply D', 'verify'], outcome: 'A', confidence: 0.81 }
  // escalated → dropped
  assert.equal(distillExperience({ ...base, gateDecision: 'escalate', replayClass: 'exact' }), null)
  // observation-only → dropped
  assert.equal(distillExperience({ ...base, gateDecision: 'answer', replayClass: 'evidence-only' }), null)
  // no substantive steps → dropped (nothing to reuse)
  assert.equal(distillExperience({ ...base, steps: ['', '  '], gateDecision: 'answer', replayClass: 'exact' }), null)
  // gated + real path → kept
  const exp = distillExperience({ ...base, gateDecision: 'answer', replayClass: 'exact' })
  assert.ok(exp)
  assert.equal(exp!.replayClass, 'exact')
  assert.equal(exp!.confidence, 0.81)
  assert.deepEqual(exp!.steps, ['retrieve operator', 'apply D', 'verify'])
})

test('distillExperience caps step count + truncates fields (safe-trace / prompt-bloat guard)', () => {
  const steps = Array.from({ length: 20 }, (_, i) => `step ${i}`)
  const exp = distillExperience({ task: 'x'.repeat(400), steps, outcome: 'y'.repeat(400), confidence: 0.7, gateDecision: 'answer', replayClass: 'best-effort', maxSteps: 5 })!
  assert.equal(exp.steps.length, 5)
  assert.equal(exp.task.length, 200)
  assert.equal(exp.outcome.length, 200)
})

// ── retrieval: relevance × success × confidence, topK / minMatch ─────────────────
const jaccard = (a: string, b: string): number => {
  const A = new Set(a.toLowerCase().split(/\s+/)), B = new Set(b.toLowerCase().split(/\s+/))
  const inter = [...A].filter((x) => B.has(x)).length
  return inter / (A.size + B.size - inter || 1)
}

test('retrieveExperiences ranks by relevance and respects topK/minMatch', () => {
  const store: ReasoningExperience[] = [
    distillExperience({ task: 'compute eigenvalues of a matrix', steps: ['a'], outcome: 'A', confidence: 0.9, gateDecision: 'answer', replayClass: 'exact' })!,
    distillExperience({ task: 'bake a chocolate cake', steps: ['b'], outcome: 'B', confidence: 0.9, gateDecision: 'answer', replayClass: 'exact' })!,
    distillExperience({ task: 'eigenvalues of a linear operator', steps: ['c'], outcome: 'C', confidence: 0.5, gateDecision: 'answer', replayClass: 'best-effort' })!,
  ]
  const hits = retrieveExperiences('eigenvalues of a matrix operator', store, jaccard, { topK: 2, minMatch: 0.1 })
  assert.ok(hits.length <= 2)
  assert.ok(hits.length >= 1)
  // the cake (no token overlap) must not appear
  assert.ok(!hits.some((h) => h.outcome === 'B'))
})

test('renderExperiences emits a verified-tasks block (or empty for no hits)', () => {
  assert.equal(renderExperiences([]), '')
  const exp = distillExperience({ task: 'integrate by parts', steps: ['u dv', 'apply', 'check'], outcome: 'done', confidence: 0.77, gateDecision: 'answer', replayClass: 'exact' })!
  const block = renderExperiences([{ ...exp, relevance: 0.6 }])
  assert.match(block, /Reasoning from similar verified tasks/)
  assert.match(block, /u dv → apply → check/)
  assert.match(block, /reliability gate/)
})

test('recordUse tracks success rate generically (Skill or Experience)', () => {
  let exp = distillExperience({ task: 't', steps: ['s'], outcome: 'o', confidence: 0.6, gateDecision: 'answer', replayClass: 'exact' })!
  assert.equal(successRate(exp), 0.5)   // unused → neutral prior
  exp = recordUse(exp, true); exp = recordUse(exp, false)
  assert.equal(successRate(exp), 0.5)
  exp = recordUse(exp, true)
  assert.equal(successRate(exp), 2 / 3)
})
