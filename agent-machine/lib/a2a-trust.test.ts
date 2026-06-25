import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recordOutcome, checkActorGrant, authorityStatus, authorityState, _reset } from './a2a-trust.js'

const PEER = 'spiffe://aiwg.io/server/sdlc-1'

test('a2a: fresh peer is cautious-but-allowed at the default floor, denied at a high floor', () => {
  _reset()
  assert.equal(checkActorGrant(PEER, 'read_artifacts').valid, true)
  assert.equal(checkActorGrant(PEER, 'graph_write', 0.8).valid, false, 'sensitive cap must be earned')
})

test('a2a: a threat strike suspends; integrity strike revokes (canonical TrustOps states)', () => {
  _reset()
  for (let i = 0; i < 20; i++) recordOutcome(PEER, { ok: true, up: true })
  assert.equal(authorityStatus(PEER), 'active')
  recordOutcome(PEER, { threat: true })
  assert.equal(authorityStatus(PEER), 'suspended')
  assert.equal(checkActorGrant(PEER, 'read_artifacts').valid, false, 'suspended actor denied')
  _reset()
  for (let i = 0; i < 20; i++) recordOutcome(PEER, { ok: true, up: true })
  recordOutcome(PEER, { integrityViolation: true })
  assert.equal(authorityStatus(PEER), 'revoked')
})

test('a2a: authorityState emits the canonical agent-registry schema', () => {
  _reset()
  const s = authorityState(PEER) as Record<string, unknown>
  assert.equal(s.schemaVersion, 'agent-registry.agent-authority-current-state.v0.1')
  assert.equal(s.recordType, 'AgentAuthorityCurrentState')
  for (const k of ['stateId', 'agentRef', 'authority_status', 'authorityEffects', 'restoration_required', 'receipt_hash']) {
    assert.ok(s[k] !== undefined, `required field ${k}`)
  }
})

test('a2a: a peer recovers after a sustained clean streak', () => {
  _reset()
  for (let i = 0; i < 20; i++) recordOutcome(PEER, { ok: true, up: true })
  recordOutcome(PEER, { threat: true })
  assert.equal(authorityStatus(PEER), 'suspended')
  for (let i = 0; i < 12; i++) recordOutcome(PEER, { ok: true, up: true })
  assert.equal(authorityStatus(PEER), 'active', 'recovers to active after a clean streak')
})
