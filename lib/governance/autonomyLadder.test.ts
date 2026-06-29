import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateAutonomy, roleCeiling, toAdmissionReceipt, TRUST_KERNEL_GATE_ORDER } from './autonomyLadder.js'

test('L0 is always grantable without evidence', () => {
  const d = evaluateAutonomy('anyone', 'L0', [])
  assert.equal(d.grantedLevel, 'L0')
  assert.equal(d.decision, 'admit')
  assert.equal(d.demoted, false)
})

test('full evidence admits the requested level', () => {
  const d = evaluateAutonomy('conductor', 'L4', ['conductor_response_envelope'])
  assert.equal(d.grantedLevel, 'L4')
  assert.equal(d.decision, 'admit')
})

test('missing evidence demotes fail-closed', () => {
  const d = evaluateAutonomy('coding', 'L2', []) // no test/review receipt
  assert.notEqual(d.grantedLevel, 'L2')
  assert.equal(d.demoted, true)
  assert.match(d.reason, /demote/)
})

test('role ceiling caps authorization', () => {
  // 'writing' is in the full L4 choir but never declared at L5.
  assert.equal(roleCeiling('writing'), 4)
  const d = evaluateAutonomy('writing', 'L5', ['continuous_attestation_with_revocation'])
  assert.equal(d.roleCeiling, 'L4')
  assert.notEqual(d.grantedLevel, 'L5')
  assert.match(d.reason, /not authorized/)
})

test('unknown role floors at L0 -> deny', () => {
  const d = evaluateAutonomy('memory-steward', 'L3', [])
  assert.equal(d.roleCeiling, 'L0')
  assert.equal(d.grantedLevel, 'L0')
  assert.equal(d.decision, 'deny')
})

test('malformed/negative level floors to L0 without a contradictory decision', () => {
  for (const bad of ['L-5', '-3', 'banana', '']) {
    const d = evaluateAutonomy('coding', bad, [])
    assert.equal(d.requestedLevel, 'L0', `${bad} should normalize to L0`)
    assert.equal(d.grantedLevel, 'L0')
    assert.equal(d.decision, 'admit') // requested==granted==L0, no contradiction
    assert.equal(d.demoted, false)
  }
})

test('toAdmissionReceipt produces a contract-shaped record', () => {
  const d = evaluateAutonomy('coding', 'L3', ['test_result_or_review_receipt'])
  const r = toAdmissionReceipt(d, {
    receipt_id: 'aar-test-1',
    created_at: '2026-06-28T00:00:00Z',
    subject_ref: 'agent://choir/coding/run-1',
    evidence_refs: ['evidence://eval-fabric/replay/job-1/passed'],
    hash: 'sha256:abc',
  })
  assert.equal(r.version, '0.1')
  assert.equal(r.decision, 'demote') // L3 needs a dossier; only had a test receipt -> demote to L2
  assert.equal(r.granted_level, 'L2')
  assert.deepEqual(r.trust_kernel_gate_order, [...TRUST_KERNEL_GATE_ORDER])
})
