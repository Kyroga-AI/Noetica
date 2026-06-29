import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCcLicense, ocwResourceToPdor, type OcwResource } from './ocw-to-pdor.js'
import { evaluatePdor } from './data-onboarding.js'

test('parseCcLicense maps labels + URLs to the right type (specific-first)', () => {
  assert.equal(parseCcLicense('CC BY-NC-SA 4.0'), 'cc-by-nc-sa')
  assert.equal(parseCcLicense('https://creativecommons.org/licenses/by-nc-sa/4.0/'), 'cc-by-nc-sa')
  assert.equal(parseCcLicense('CC BY-NC-ND 4.0'), 'cc-by-nc-nd')
  assert.equal(parseCcLicense('CC BY-SA 3.0'), 'cc-by-sa')
  assert.equal(parseCcLicense('CC BY 4.0'), 'cc-by')
  assert.equal(parseCcLicense('CC0 1.0'), 'cc0')
  assert.equal(parseCcLicense('Public Domain'), 'cc0')
  assert.equal(parseCcLicense('All Rights Reserved'), 'unknown')   // fail-closed
})

test('ocwResourceToPdor builds an open-courseware PDOR with parsed license', () => {
  const r: OcwResource = { course: '18-01sc-calculus-fall-2010', title: 'Lecture 1 Notes', license: 'CC BY-NC-SA 4.0', url: 'https://ocw.mit.edu/...' }
  const p = ocwResourceToPdor(r)
  assert.equal(p.intent, 'capture')
  assert.equal(p.source.sourceType, 'open-courseware')
  assert.equal(p.license.type, 'cc-by-nc-sa')
  assert.equal(p.license.attribution, true)
  assert.equal(p.license.shareAlike, true)
  assert.equal(p.id, 'ocw:18-01sc-calculus-fall-2010')
})

test('MIT OCW (CC-BY-NC-SA) is BRAIN-ELIGIBLE in the commons, SEGMENTED outside it', () => {
  const p = ocwResourceToPdor({ course: '8-01-physics', title: 'Mechanics', license: 'CC BY-NC-SA 4.0' })
  // In the Knowledge Commons (non-commercial + share-alike): learnable → self-certified into the brain.
  const commons = evaluatePdor(p, [], { commons: true })
  assert.equal(commons.brainEligible, true)
  assert.equal(commons.segmented, false)
  assert.equal(commons.status, 'self-certified')
  // Strict default: NC/SA → not brain-eligible → segmented (needs review).
  const strict = evaluatePdor(p)
  assert.equal(strict.brainEligible, false)
  assert.equal(strict.segmented, true)
  // either way the obligations are recorded
  assert.ok(commons.rules.includes('attribute-on-use') && commons.rules.includes('share-alike') && commons.rules.includes('non-commercial-only'))
})

test('a no-derivatives OCW resource stays SEGMENTED even in the commons (a model is a derivative)', () => {
  const p = ocwResourceToPdor({ course: 'x', title: 'ND course', license: 'CC BY-NC-ND 4.0' })
  const d = evaluatePdor(p, [], { commons: true })
  assert.equal(d.brainEligible, false)
  assert.equal(d.segmented, true)
  assert.ok(d.rules.includes('no-derivatives'))
})

test('CC-BY OCW is brain-eligible in BOTH contexts', () => {
  const p = ocwResourceToPdor({ course: 'y', title: 'BY course', license: 'CC BY 4.0' })
  assert.equal(evaluatePdor(p).brainEligible, true)
  assert.equal(evaluatePdor(p, [], { commons: true }).brainEligible, true)
})

test('unrecognized license fails closed → segmented', () => {
  const p = ocwResourceToPdor({ course: 'z', title: 'mystery', license: 'proprietary blob' })
  assert.equal(p.license.type, 'unknown')
  assert.equal(evaluatePdor(p, [], { commons: true }).brainEligible, false)
})

test('parseCcLicense fails CLOSED on non-CC strings that merely contain "zero" or "by"', () => {
  // the review-flagged leaks: must NOT promote to a brain-eligible CC license
  assert.equal(parseCcLicense('Created by John Doe'), 'unknown')
  assert.equal(parseCcLicense('Distributed by O’Reilly'), 'unknown')
  assert.equal(parseCcLicense('Zero-Clause BSD'), 'unknown')
  assert.equal(parseCcLicense('ZeroSSL License'), 'unknown')
  // and they never reach the brain
  assert.equal(evaluatePdor(ocwResourceToPdor({ course: 'x', title: 't', license: 'Created by John Doe' }), [], { commons: true }).brainEligible, false)
})
