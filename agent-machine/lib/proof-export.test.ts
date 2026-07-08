/** Tests for the offline-verifiable proof bundle. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildProofBundle, verifyProofBundle } from './proof-export.js'

const INPUT = {
  runId: 'run-123',
  question: 'What is the capital of France?',
  answer: 'Paris is the capital of France.',
  model: 'qwen3:14b',
  timestamp: '2026-07-08T00:00:00.000Z',
  verification: { computed: false, method: 'self-consistency', replayClass: 'best-effort', attested: true, badge: 'Reasoned · self-consistency · attested' },
  citations: [{ n: 1, source: 'geography.md', ref: 'doc1', score: 0.92, grounding_status: 'grounded' }],
  groundingStatus: 'grounded',
}

test('a freshly sealed bundle verifies fully offline', () => {
  const bundle = buildProofBundle(INPUT, '2026-07-08T00:00:01.000Z')
  const r = verifyProofBundle(bundle)
  assert.equal(r.valid, true, r.reasons.join('; '))
  assert.equal(r.chainValid, true)
  assert.equal(r.signatureValid, true)
  assert.equal(r.pseudonymValid, true)
  assert.equal(r.attestationValid, true)
  assert.ok(bundle.signer.pseudonym.startsWith('did:key:z'))
})

test('editing the answer breaks the chain', () => {
  const bundle = buildProofBundle(INPUT, '2026-07-08T00:00:01.000Z')
  bundle.run.answer = 'Lyon is the capital of France.'   // tamper AFTER sealing
  const r = verifyProofBundle(bundle)
  assert.equal(r.valid, false)
  assert.equal(r.chainValid, false)
  assert.equal(r.brokenAt, 0)   // the run record is index 0
})

test('editing a citation breaks the chain', () => {
  const bundle = buildProofBundle(INPUT, '2026-07-08T00:00:01.000Z')
  ;(bundle.citations[0] as { source: string }).source = 'forged.md'
  const r = verifyProofBundle(bundle)
  assert.equal(r.valid, false)
  assert.equal(r.chainValid, false)
})

test('swapping the signature is rejected', () => {
  const bundle = buildProofBundle(INPUT, '2026-07-08T00:00:01.000Z')
  const other = buildProofBundle({ ...INPUT, answer: 'different' }, '2026-07-08T00:00:02.000Z')
  bundle.signer.signature = other.signer.signature   // valid signature, wrong head
  const r = verifyProofBundle(bundle)
  assert.equal(r.valid, false)
  assert.equal(r.signatureValid, false)
})

test('a stale bundle still verifies (durable proof — no freshness gate)', () => {
  // Attestation timestamp is "now" at seal time; verification must NOT reject it for age.
  const bundle = buildProofBundle(INPUT, '2000-01-01T00:00:00.000Z')
  const r = verifyProofBundle(bundle)
  assert.equal(r.attestationValid, true, r.reasons.join('; '))
  assert.equal(r.valid, true)
})
