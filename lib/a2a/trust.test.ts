import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recordOutcome, actorTrust, trustVerdict, isExternalActor, _resetTrust, TRUST_FLOOR, authorityStatus, authorityState } from './trust.js'

const LOCAL = 'spiffe://noetica.local/session/abc'
const PEER = 'spiffe://ruflo.swarm/queen/strategic-1'

test('local actors start trusted, external peers start cautious', () => {
  _resetTrust()
  assert.equal(isExternalActor(LOCAL), false)
  assert.equal(isExternalActor(PEER), true)
  assert.ok(trustVerdict(LOCAL).trusted, 'fresh local session is trusted')
  assert.ok(actorTrust(LOCAL) > actorTrust(PEER), 'local starts higher than a cold external peer')
})

test('instant downgrade: one threat strike denies regardless of prior good standing', () => {
  _resetTrust()
  for (let i = 0; i < 20; i++) recordOutcome(LOCAL, { ok: true, up: true })   // earn a strong record
  assert.ok(trustVerdict(LOCAL).trusted)
  recordOutcome(LOCAL, { threat: true })                                       // one strike
  assert.equal(trustVerdict(LOCAL).trusted, false, 'a single threat strike denies immediately')
})

test('integrity violation denies and recovers slower than a threat', () => {
  _resetTrust()
  for (let i = 0; i < 20; i++) recordOutcome(PEER, { ok: true, up: true })
  recordOutcome(PEER, { integrityViolation: true })
  assert.equal(trustVerdict(PEER).trusted, false, 'integrity strike denies')
  // a few clean turns are NOT enough to clear an integrity (set to 0) strike
  for (let i = 0; i < 3; i++) recordOutcome(PEER, { ok: true, up: true })
  assert.equal(trustVerdict(PEER).trusted, false, 'integrity recovers slowly — still denied after 3 clean turns')
})

test('slow upgrade: a struck actor recovers after enough clean turns', () => {
  _resetTrust()
  for (let i = 0; i < 20; i++) recordOutcome(LOCAL, { ok: true, up: true })
  recordOutcome(LOCAL, { threat: true })
  assert.equal(trustVerdict(LOCAL).trusted, false)
  for (let i = 0; i < 10; i++) recordOutcome(LOCAL, { ok: true, up: true })   // clean streak
  assert.ok(trustVerdict(LOCAL).trusted, 'recovers after a sustained clean streak')
})

test('sensitive capabilities can demand a higher floor than a cold peer clears', () => {
  _resetTrust()
  const v = trustVerdict(PEER, 0.8)   // a high-trust capability
  assert.equal(v.trusted, false, 'a cold external peer cannot pass a high floor')
  assert.ok(v.score < 0.8)
})

test('a peer EARNS standing through a track record', () => {
  _resetTrust()
  const before = actorTrust(PEER)
  for (let i = 0; i < 30; i++) recordOutcome(PEER, { ok: true, up: true })
  assert.ok(actorTrust(PEER) > before, 'sustained success raises the peer score')
  assert.ok(actorTrust(PEER) > TRUST_FLOOR, 'an earned peer clears the default floor')
})

test('TrustOps projection: behavioral state → canonical authority_status + effects', () => {
  _resetTrust()
  for (let i = 0; i < 20; i++) recordOutcome(LOCAL, { ok: true, up: true })
  assert.equal(authorityStatus(LOCAL), 'active')
  recordOutcome(LOCAL, { threat: true })
  assert.equal(authorityStatus(LOCAL), 'suspended', 'threat strike → suspended (recovers)')
  _resetTrust()
  for (let i = 0; i < 20; i++) recordOutcome(LOCAL, { ok: true, up: true })
  recordOutcome(LOCAL, { integrityViolation: true })
  assert.equal(authorityStatus(LOCAL), 'revoked', 'integrity strike → revoked (needs restoration)')

  const rec = authorityState(LOCAL)
  assert.equal(rec.schemaVersion, 'agent-registry.agent-authority-current-state.v0.1')
  assert.equal(rec.recordType, 'AgentAuthorityCurrentState')
  assert.equal(rec.authority_status, 'revoked')
  assert.equal(rec.restoration_required, true)
  assert.equal(rec.authorityEffects.toolAccess, 'blocked')
  for (const k of ['stateId', 'agentRef', 'computed_at', 'effective_decision_ref', 'source_decision_refs', 'evidenceRefs', 'authorityEffects', 'receipt_hash']) {
    assert.ok((rec as unknown as Record<string, unknown>)[k] !== undefined, `required field ${k} present`)
  }
})
