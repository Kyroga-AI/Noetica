/** Batch 5 — orchestration + UX trust + privacy: proposals, plan-mode, multi-agent, gen-ui, model-signing. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { proposalsFromInferred, setStatus, applyAccepted } from './graph-proposals.js'
import { makePlan, editPlan, nextStep, completeStep, canExecute } from './plan-mode.js'
import { decompose, aggregate } from './multi-agent.js'
import { validateUISpec, sanitizeUISpecs } from './gen-ui.js'
import { digestEquals, verifyManifest } from './model-signing.js'

test('graph-proposals: only accepted proposals become mutations', () => {
  let props = proposalsFromInferred([
    { subject: 'A', predicate: 'depends on', object: 'C', via: 'B', verified: true },
    { subject: 'X', predicate: 'relates to', object: 'Y' },
  ])
  assert.equal(props.length, 2)
  props = setStatus(props, props[0]!.id, 'accepted')
  props = setStatus(props, props[1]!.id, 'rejected')
  const { mutations, summary } = applyAccepted(props)
  assert.equal(mutations.length, 1)
  assert.equal(summary.adds, 1)
  assert.equal(mutations[0]!.payload.from, 'A')
})

test('plan-mode: cannot execute until approved; removed steps are skipped', () => {
  let plan = makePlan(['gather', 'risky delete', 'report'])
  assert.equal(canExecute(plan), false, 'unapproved → blocked')
  assert.equal(nextStep(plan), null)
  plan = editPlan(plan, { remove: [1], approve: true })
  assert.equal(canExecute(plan), true)
  assert.equal(nextStep(plan)!.text, 'gather')
  plan = completeStep(plan, 0)
  assert.equal(nextStep(plan)!.text, 'report', 'removed step 1 skipped')
})

test('multi-agent: difficulty routes to mesh tier; aggregate orders by confidence', () => {
  const subs = decompose([{ objective: 'easy', difficulty: 0.2 }, { objective: 'hard', difficulty: 0.9 }])
  assert.equal(subs[0]!.tier, 'local')
  assert.equal(subs[1]!.tier, 'frontier')
  const agg = aggregate([{ id: 'a', output: 'x', confidence: 0.3 }, { id: 'b', output: 'y', confidence: 0.9 }, { id: 'c', output: '' }])
  assert.equal(agg.ordered[0]!.id, 'b')
  assert.ok(Math.abs(agg.coverage - 2 / 3) < 1e-9, 'empty output excluded from coverage')
})

test('gen-ui: whitelist + required props; disallowed components dropped', () => {
  assert.equal(validateUISpec({ component: 'card', props: { title: 'Hi' } }).valid, true)
  assert.equal(validateUISpec({ component: 'card', props: {} }).valid, false, 'missing required title')
  assert.equal(validateUISpec({ component: 'iframe', props: {} }).valid, false, 'not whitelisted')
  assert.equal(sanitizeUISpecs([{ component: 'metric', props: { label: 'x', value: 1 } }, { component: 'script', props: {} }]).length, 1)
})

test('model-signing: constant-time digest compare + manifest verification', () => {
  assert.equal(digestEquals('ABC123', 'abc123'), true)
  assert.equal(digestEquals('abc', 'abd'), false)
  const ok = verifyManifest([{ path: 'weights.bin', sha256: 'aa' }], { 'weights.bin': 'AA' })
  assert.equal(ok.ok, true)
  const bad = verifyManifest([{ path: 'weights.bin', sha256: 'ff' }], { 'weights.bin': 'aa', 'config.json': 'bb' })
  assert.equal(bad.ok, false)
  assert.equal(bad.mismatches.length >= 1 && bad.missing.includes('config.json'), true)
})
