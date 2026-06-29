import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluatePdor, openness, brainEligible, governanceRules, type Pdor, type PdorVerdict } from './data-onboarding.js'

const base = (over: Partial<Pdor> = {}): Pdor => ({
  id: 'p1', requester: 'r', intent: 'capture',
  source: { name: 'MIT OCW 8.01' },
  license: { type: 'cc-by' },
  ...over,
})

test('open + clean → self-certified INTO the sovereign brain (no review)', () => {
  const d = evaluatePdor(base({ license: { type: 'cc-by' } }))
  assert.equal(d.tier, 'open')
  assert.equal(d.brainEligible, true)
  assert.equal(d.segmented, false)
  assert.equal(d.status, 'self-certified')
  assert.equal(d.requiresReview, false)
  assert.ok(d.ingestKey)
})

test('CC0 / public-domain are brain-eligible; CC-BY adds attribute-on-use', () => {
  assert.equal(brainEligible(base({ license: { type: 'cc0' } })), true)
  assert.equal(brainEligible(base({ license: { type: 'public-domain' } })), true)
  assert.ok(governanceRules(base({ license: { type: 'cc-by' } })).includes('attribute-on-use'))
})

test('CC-BY-SA (copyleft) is SEGMENTED, never trained — the Wikipedia-text rule', () => {
  const d = evaluatePdor(base({ license: { type: 'cc-by-sa' } }))
  assert.equal(d.openness, 'licensed')
  assert.equal(d.brainEligible, false)
  assert.equal(d.segmented, true)
  assert.equal(d.requiresReview, true)
  assert.ok(d.rules.includes('segment-from-brain'))
  assert.ok(d.rules.includes('share-alike'))
})

test('unknown license fails CLOSED → not brain-eligible, licensed tier', () => {
  const d = evaluatePdor(base({ license: { type: 'unknown' } }))
  assert.equal(d.brainEligible, false)
  assert.equal(d.openness, 'licensed')
})

test('sensitivity ALWAYS wins → restricted + segmented, even with an open license', () => {
  const d = evaluatePdor(base({ license: { type: 'cc-by' }, classification: { pii: true } }))
  assert.equal(d.openness, 'restricted')
  assert.equal(d.tier, 'restricted')
  assert.equal(d.brainEligible, false)            // open license can't save PII content
  assert.ok(d.rules.includes('access-control') && d.rules.includes('redact-sensitive'))
})

test('licensed tier needs license+segmentation verdicts; approves → key issued, segmented', () => {
  const p = base({ license: { type: 'cc-by-nc' } })
  assert.equal(evaluatePdor(p).status, 'needs-review')
  const verdicts: PdorVerdict[] = [
    { reviewer: 'a', role: 'license', approve: true },
    { reviewer: 'b', role: 'segmentation', approve: true },
  ]
  const d = evaluatePdor(p, verdicts)
  assert.equal(d.status, 'approved')
  assert.ok(d.ingestKey)
  assert.equal(d.segmented, true)
  assert.ok(d.rules.includes('non-commercial-only'))
})

test('restricted tier additionally needs a governance verdict', () => {
  const p = base({ classification: { phi: true } })
  const partial: PdorVerdict[] = [{ reviewer: 'a', role: 'license', approve: true }, { reviewer: 'b', role: 'segmentation', approve: true }]
  assert.equal(evaluatePdor(p, partial).status, 'needs-review')   // governance still missing
  const full = partial.concat({ reviewer: 'c', role: 'governance', approve: true })
  assert.equal(evaluatePdor(p, full).status, 'approved')
})

test('any decline → declined, no key', () => {
  const d = evaluatePdor(base({ license: { type: 'proprietary' } }), [{ reviewer: 'a', role: 'license', approve: false, note: 'no rights' }])
  assert.equal(d.status, 'declined')
  assert.equal(d.ingestKey, null)
})

test('register intent → candidate bookmark, not loaded', () => {
  const d = evaluatePdor(base({ intent: 'register' }))
  assert.equal(d.tier, 'candidate')
  assert.equal(d.status, 'bookmarked')
  assert.equal(d.ingestKey, null)
})

test('scope maps to the review tier (open→CITIZEN_FOG, licensed→CLOUD, restricted→INSTITUTION)', () => {
  assert.equal(evaluatePdor(base()).scope, 'CITIZEN_FOG')
  assert.equal(evaluatePdor(base({ license: { type: 'cc-by-sa' } })).scope, 'CITIZEN_CLOUD')
  assert.equal(evaluatePdor(base({ classification: { confidential: true } })).scope, 'INSTITUTION')
})

test('regulated content attaches periodic-compliance-review', () => {
  assert.ok(governanceRules(base({ classification: { regulated: true } })).includes('periodic-compliance-review'))
})

test('commons mode: NC/SA become brain-eligible (commons satisfies NC+SA); default stays strict', () => {
  const p = base({ license: { type: 'cc-by-sa' } })
  assert.equal(brainEligible(p), false)                  // strict default
  assert.equal(brainEligible(p, { commons: true }), true) // commons-eligible
  const nc = base({ license: { type: 'cc-by-nc-sa' } })
  assert.equal(brainEligible(nc, { commons: true }), true)
  assert.equal(evaluatePdor(nc, [], { commons: true }).status, 'self-certified')
})

test('commons mode does NOT relax no-derivatives or sensitivity', () => {
  assert.equal(brainEligible(base({ license: { type: 'cc-by-nd' } }), { commons: true }), false)        // ND barred
  assert.equal(brainEligible(base({ license: { type: 'cc-by' }, classification: { pii: true } }), { commons: true }), false)  // PII barred
})
