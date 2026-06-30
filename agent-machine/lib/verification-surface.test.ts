/**
 * verification-surface.test — the VISIBLE-SURFACE promotion: buildVerification (the
 * verified-compute badge / kill-shot) + buildCitations (inline citations UX). Pure unit
 * tests, NO model / NO ollama / NO network: every input is a stubbed turn-state shape.
 *
 * Asserts the buying-reason contract:
 *  (a) a computed/operator turn → verification.computed=true, replayClass=exact, badge
 *      contains "Computed", attested=true when a receipt ref is present;
 *  (b) a generated turn → computed=false, badge "Generated…";
 *  (c) a retrieval turn → non-empty citations[] numbered from 1;
 *  (d) a no-retrieval turn → citations: [].
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildVerification, buildCitations } from './reasoning-evidence.js'

// ─── (a) computed / operator-compute turn ──────────────────────────────────────
test('operator-compute turn yields computed=true, replayClass=exact, attested badge', () => {
  const v = buildVerification({
    replayClass: 'exact',
    verifiedMethod: 'operator-compute',
    receiptRef: 'urn:srcos:receipt:reasoning:abc123',
    runRef: 'urn:srcos:reasoning-run:abc123',
  })
  assert.equal(v.computed, true)
  assert.equal(v.replayClass, 'exact')
  assert.equal(v.method, 'operator-compute')
  assert.equal(v.attested, true)
  assert.match(v.badge, /Computed/)
  assert.match(v.badge, /attested/)
  assert.equal(v.receiptRef, 'urn:srcos:receipt:reasoning:abc123')
  assert.equal(v.runRef, 'urn:srcos:reasoning-run:abc123')
  assert.equal(v.sealable, true)
})

test('code-verify turn is computed and exact', () => {
  const v = buildVerification({ replayClass: 'exact', verifiedMethod: 'code-verify', receiptRef: 'urn:srcos:receipt:reasoning:x' })
  assert.equal(v.computed, true)
  assert.equal(v.method, 'code-verify')
  assert.match(v.badge, /Computed/)
})

test('recall turn (laneMethod) is computed-exact and attested', () => {
  const v = buildVerification({ replayClass: 'exact', laneMethod: 'recall', receiptRef: 'urn:srcos:receipt:reasoning:r' })
  assert.equal(v.computed, true)
  assert.equal(v.method, 'recall')
  assert.match(v.badge, /Computed/)
  assert.equal(v.attested, true)
})

test('extractive turn is computed-exact', () => {
  const v = buildVerification({ replayClass: 'exact', laneMethod: 'extractive', receiptRef: 'urn:srcos:receipt:reasoning:e' })
  assert.equal(v.computed, true)
  assert.equal(v.method, 'extractive')
  assert.match(v.badge, /Computed/)
})

test('computed turn WITHOUT a receipt is computed but not attested (badge omits attested)', () => {
  const v = buildVerification({ replayClass: 'exact', verifiedMethod: 'operator-compute', receiptRef: null })
  assert.equal(v.computed, true)
  assert.equal(v.attested, false)
  assert.match(v.badge, /Computed/)
  assert.doesNotMatch(v.badge, /attested/)
})

// ─── (b) generated turn ────────────────────────────────────────────────────────
test('generated turn yields computed=false and a "Generated" badge', () => {
  const v = buildVerification({ replayClass: 'best-effort', receiptRef: 'urn:srcos:receipt:reasoning:g' })
  assert.equal(v.computed, false)
  assert.equal(v.method, 'generated')
  assert.match(v.badge, /Generated/)
  assert.doesNotMatch(v.badge, /Computed/)
  // honest: never claims computed for a generated turn
  assert.equal(v.replayClass, 'best-effort')
})

test('reason-lane turn is Reasoned (not Computed) and best-effort', () => {
  const v = buildVerification({ replayClass: 'best-effort', reasonLane: true, receiptRef: 'urn:srcos:receipt:reasoning:rl' })
  assert.equal(v.computed, false)
  assert.equal(v.method, 'reason-lane')
  assert.match(v.badge, /Reasoned/)
  assert.doesNotMatch(v.badge, /^Computed/)
})

test('buildVerification never throws on garbage input', () => {
  // @ts-expect-error — exercise the catch path with deliberately bad input
  const v = buildVerification(null)
  assert.equal(v.computed, false)
  assert.equal(v.method, 'generated')
  assert.match(v.badge, /Generated/)
})

// ─── (c) retrieval turn → numbered citations ────────────────────────────────────
test('retrieval turn yields a non-empty citations array numbered from 1', () => {
  const hits = [
    { docId: 'doc:aa', filename: '18.06-linear-algebra.pdf', text: 'IGNORED RAW TEXT', score: 0.91 },
    { docId: 'doc:bb', filename: 'strang-notes.pdf', text: 'IGNORED RAW TEXT', score: 0.77 },
  ]
  const cites = buildCitations(hits, 'grounded')
  assert.equal(cites.length, 2)
  assert.equal(cites[0].n, 1)
  assert.equal(cites[1].n, 2)
  assert.equal(cites[0].source, '18.06-linear-algebra.pdf')
  assert.equal(cites[0].ref, 'doc:aa')
  assert.equal(cites[0].score, 0.91)
  assert.equal(cites[0].grounding_status, 'grounded')
  // safe-trace: raw chunk text is NEVER surfaced
  for (const c of cites) {
    assert.doesNotMatch(JSON.stringify(c), /IGNORED RAW TEXT/)
  }
})

test('citations prefer title over filename, fall back to docId', () => {
  const cites = buildCitations([{ docId: 'doc:x', title: 'Inception PoE', score: 0.5 }])
  assert.equal(cites[0].source, 'Inception PoE')
})

// ─── (d) no-retrieval turn → empty citations ────────────────────────────────────
test('no-retrieval turn yields citations: []', () => {
  assert.deepEqual(buildCitations([], 'grounded'), [])
  assert.deepEqual(buildCitations(null), [])
  assert.deepEqual(buildCitations(undefined), [])
})

test('buildCitations never throws on garbage input', () => {
  // @ts-expect-error — exercise the catch path
  assert.deepEqual(buildCitations(42), [])
})
