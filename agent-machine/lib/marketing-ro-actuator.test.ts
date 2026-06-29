import { test } from 'node:test'
import assert from 'node:assert'
import { actuateRecommendation, type RecommendationObject } from './marketing-ro-actuator.js'

function sampleRO(): RecommendationObject {
  return {
    id: 'urn:srcos:recommendation-object:ro_test_publish',
    type: 'RecommendationObject',
    specVersion: '2.0.0',
    scope: { properties: ['socioprophet.com'] },
    action: { kind: 'publish_static_files', files: ['robots.txt'] },
    risk: { policyCompliance: 0, privacy: 0 },
    status: 'proposed',
    autonomyLevel: 2,
    evidence: { source: 'semrush-site-audit-2026-03-04' },
  }
}

test('admits and actuates when the L2 gate evidence is present', async () => {
  let actuated = false
  const res = await actuateRecommendation(
    sampleRO(),
    ['test_result_or_review_receipt'],
    () => {
      actuated = true
    },
  )
  assert.equal(res.admitted, true)
  assert.equal(actuated, true, 'actuate side-effect must run on admit')
  assert.equal(res.ro.status, 'actuated')
  assert.ok(res.ro.admissionReceiptRef?.startsWith('aar-'))
  assert.equal(res.decision.decision, 'admit')
  assert.equal(res.receipt.version, '0.1')
  assert.ok(res.receipt.hash.startsWith('sha256:'))
})

test('fails closed: no actuation without the required gate evidence', async () => {
  let actuated = false
  const res = await actuateRecommendation(
    sampleRO(),
    [], // no evidence -> gate cannot admit at L2
    () => {
      actuated = true
    },
  )
  assert.equal(res.admitted, false)
  assert.equal(actuated, false, 'actuate side-effect must NOT run when denied')
  assert.equal(res.ro.status, 'rejected')
  assert.equal(res.ro.admissionReceiptRef, null)
  assert.notEqual(res.decision.decision, 'admit')
})

test('outward-facing disavow defaults to L4 and is denied without channel-governed evidence', async () => {
  const ro = sampleRO()
  ro.action = { kind: 'disavow_domains', domains: ['all-aged-domains.com'] }
  delete ro.autonomyLevel // force lookup from ACTION_AUTONOMY_LEVEL
  const res = await actuateRecommendation(ro, ['test_result_or_review_receipt'])
  assert.equal(res.admitted, false, 'L4 action must not be admitted on L2 evidence')
})
