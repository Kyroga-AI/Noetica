import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkActorGrant, recordActorOutcome, revokeGrant, unrevokeGrant } from './grantCheck.js'
import { _resetTrust } from './trust.js'

const PEER = 'spiffe://aiwg.io/server/sdlc-2'

test('federated grant: a cold peer is allowed routine caps, denied sensitive ones', () => {
  _resetTrust()
  assert.equal(checkActorGrant(PEER, 'read_artifacts').valid, true)
  assert.equal(checkActorGrant(PEER, 'graph_write', 0.8).valid, false, 'sensitive cap demands earned trust')
})

test('federated grant: a threat strike denies the peer (suspended), recovery re-allows', () => {
  _resetTrust()
  for (let i = 0; i < 20; i++) recordActorOutcome(PEER, { ok: true, up: true })
  assert.equal(checkActorGrant(PEER, 'read_artifacts').valid, true)
  recordActorOutcome(PEER, { threat: true })
  assert.equal(checkActorGrant(PEER, 'read_artifacts').valid, false, 'suspended after a threat')
  for (let i = 0; i < 12; i++) recordActorOutcome(PEER, { ok: true, up: true })
  assert.equal(checkActorGrant(PEER, 'read_artifacts').valid, true, 'recovers after a clean streak')
})

test('federated grant: explicit revocation overrides trust', () => {
  _resetTrust()
  for (let i = 0; i < 20; i++) recordActorOutcome(PEER, { ok: true, up: true })
  revokeGrant(PEER)
  assert.equal(checkActorGrant(PEER, 'read_artifacts').valid, false, 'revoked even with high trust')
  unrevokeGrant(PEER)
  assert.equal(checkActorGrant(PEER, 'read_artifacts').valid, true)
})
