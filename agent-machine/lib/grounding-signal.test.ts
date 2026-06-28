import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideGrounding, groundingSignalEnabled, type GroundingStatus } from './grounding-signal.js'

// Stub canonRoute: returns a fixed grounding_status (the only field decideGrounding reads).
const stub = (status: GroundingStatus) => () => ({ grounding_status: status })
const ON: NodeJS.ProcessEnv = {}                              // flag default ON
const OFF: NodeJS.ProcessEnv = { NOETICA_GROUNDING_SIGNAL: '0' }

// ── (a) telemetry: status flows through for a retrieval-eligible intent, each enum value ──
test('telemetry: grounded → active, status surfaced, no retrieve-force, no partial marker', () => {
  const d = decideGrounding('q', true, { route: stub('grounded'), env: ON })
  assert.equal(d.active, true)
  assert.equal(d.status, 'grounded')
  assert.equal(d.ensureRetrieve, false)   // DEAD-END GUARD: 'grounded' must NOT drive retrieval behaviour
  assert.equal(d.partial, false)
})

test('telemetry: partial → status surfaced + uncertainty marker, no retrieve-force', () => {
  const d = decideGrounding('q', true, { route: stub('partial'), env: ON })
  assert.equal(d.active, true)
  assert.equal(d.status, 'partial')
  assert.equal(d.partial, true)           // (c) partial → uncertainty marker
  assert.equal(d.ensureRetrieve, false)
})

test('telemetry: ungrounded → status surfaced', () => {
  const d = decideGrounding('q', true, { route: stub('ungrounded'), env: ON })
  assert.equal(d.active, true)
  assert.equal(d.status, 'ungrounded')
})

// ── (b) ensure-retrieve on ungrounded; partial carries the marker ──
test('ensure-retrieve: ungrounded → retrieval is required (ensureRetrieve true)', () => {
  const d = decideGrounding('q', true, { route: stub('ungrounded'), env: ON })
  assert.equal(d.ensureRetrieve, true)
  assert.equal(d.partial, false)
})

test('partial → marker set, ensureRetrieve stays false', () => {
  const d = decideGrounding('q', true, { route: stub('partial'), env: ON })
  assert.equal(d.partial, true)
  assert.equal(d.ensureRetrieve, false)
})

// ── (c) reason-lane intents UNCHANGED: signal inert, never causes retrieval ──
test('reason-lane (retrievalEligible=false): inert, never forces retrieval, no status', () => {
  for (const s of ['grounded', 'partial', 'ungrounded'] as GroundingStatus[]) {
    const d = decideGrounding('integrate x^2 dx', false, { route: stub(s), env: ON })
    assert.equal(d.active, false)
    assert.equal(d.ensureRetrieve, false, `ungrounded must NOT force retrieval for reason lane (${s})`)
    assert.equal(d.partial, false)
    assert.equal(d.status, undefined)
  }
})

// ── (d) canonRoute throwing → turn still completes, treated as ungrounded (fallback ensures retrieval) ──
test('canonRoute throws → fallback to ungrounded (ensure-retrieve), never breaks', () => {
  const boom = () => { throw new Error('canon blew up') }
  const d = decideGrounding('q', true, { route: boom, env: ON })
  assert.equal(d.active, true)
  assert.equal(d.status, 'ungrounded')
  assert.equal(d.ensureRetrieve, true)
})

// ── env flag: =0 reverts to prior behaviour (signal inert even for eligible intents) ──
test('flag: NOETICA_GROUNDING_SIGNAL=0 → inert (active false), reverts to current behaviour', () => {
  const d = decideGrounding('q', true, { route: stub('ungrounded'), env: OFF })
  assert.equal(d.active, false)
  assert.equal(d.ensureRetrieve, false)
  assert.equal(d.partial, false)
  assert.equal(d.status, undefined)
})

test('flag: default (unset) is ON', () => {
  assert.equal(groundingSignalEnabled({}), true)
  assert.equal(groundingSignalEnabled({ NOETICA_GROUNDING_SIGNAL: '0' }), false)
  assert.equal(groundingSignalEnabled({ NOETICA_GROUNDING_SIGNAL: '1' }), true)
})
