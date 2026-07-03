import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifySensitivity, decideIsolation, toMembraneDecision } from './isolation-policy.js'

test('unknown data fails closed → high / local / no egress', () => {
  const d = decideIsolation({ content: 'some benign text' })
  assert.equal(d.sensitivity, 'high')
  assert.equal(d.tier, 'local')
  assert.equal(d.egressAllowed, false)
  assert.equal(d.namespace, 'self')
})

test('public data may reach cloud (egress allowed)', () => {
  const d = decideIsolation({ labels: ['public'], content: 'a press release' })
  assert.equal(d.sensitivity, 'low')
  assert.deepEqual(d.allowedTiers, ['local', 'edge', 'cloud'])
  assert.equal(d.egressAllowed, true)
  assert.equal(d.namespace, 'collective')
})

test('secret content overrides a public label (leakage prevention)', () => {
  const d = decideIsolation({ labels: ['public'], content: 'token ghp_ABCDEFGHIJKLMNOPQRSTUV0123456789' })
  assert.equal(classifySensitivity({ content: 'ghp_ABCDEFGHIJKLMNOPQRSTUV0123456789' }), 'high')
  assert.equal(d.sensitivity, 'high')
  assert.equal(d.tier, 'local')
  assert.equal(d.egressAllowed, false)
  assert.ok(d.conflict)
})

test('requested cloud on high-sensitive is denied + clamped local', () => {
  const d = decideIsolation({ labels: ['secret'], requestedTier: 'cloud' })
  assert.equal(d.tier, 'local')
  assert.ok(d.conflict)
  assert.match(d.reason, /DENIED/)
})

test('medium data routes to edge, never cloud', () => {
  const d = decideIsolation({ labels: ['internal'] })
  assert.equal(d.sensitivity, 'medium')
  assert.equal(d.tier, 'edge')
  assert.deepEqual(d.allowedTiers, ['local', 'edge'])
  assert.equal(d.egressAllowed, false)
})

test('the self namespace keeps even low-sensitivity data on-device', () => {
  const d = decideIsolation({ labels: ['public'], namespace: 'self' })
  assert.equal(d.sensitivity, 'low')
  assert.equal(d.tier, 'local')          // namespace cap (self→local) beats sensitivity ceiling
  assert.equal(d.egressAllowed, false)
})

test('requested lower tier than the ceiling is honored', () => {
  const d = decideIsolation({ labels: ['public'], requestedTier: 'local' })
  assert.equal(d.tier, 'local')
  assert.equal(d.conflict, false)
})

test('emits a slash-topics-conformant MembraneDecision (denied egress → DENY / user_local)', () => {
  const m = toMembraneDecision(decideIsolation({ labels: ['secret'], requestedTier: 'cloud' }), { input: 'x' })
  assert.equal(m.decision, 'DENY')
  assert.equal(m.scope, 'user_local')
  assert.ok(['lsa', 'lsi', 'lda'].includes(m.model_family))
  assert.match(m.audit.policy_ref, /^sha256:[0-9a-f]{64}$/)
  assert.ok(m.audit.reasons.length > 0)
  assert.match(m.audit.ts, /\d{4}-\d\d-\d\dT/)
  assert.match(m.artifacts?.input_hash ?? '', /^sha256:/)
})

test('public collective data → ALLOW / global_platform', () => {
  const m = toMembraneDecision(decideIsolation({ labels: ['public'] }))
  assert.equal(m.decision, 'ALLOW')
  assert.equal(m.scope, 'global_platform')
})
