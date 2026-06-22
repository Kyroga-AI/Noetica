/**
 * Tests for the PII/secret firewall — security-critical: it must NOT leak, and must round-trip exactly.
 * Runs in CI via `npm test` (node --import tsx --test lib/*.test.ts).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redact, redactMany, unredact, savePolicy, loadPolicy } from './redact.js'

test('redacts every PII/secret category', () => {
  const cases: Array<[string, string]> = [
    ['email a@b.com', 'EMAIL'],
    ['ssn 123-45-6789', 'SSN'],
    ['key sk-abcdefghijklmnopqrstuv', 'APIKEY'],
    ['aws AKIAIOSFODNN7EXAMPLE here', 'APIKEY'],
    ['token eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4', 'JWT'],
    ['ip 192.168.1.42', 'IP'],
  ]
  for (const [text, kind] of cases) {
    const r = redact(text)
    assert.equal(r.count >= 1, true, `should mask in: ${text}`)
    assert.equal(text.includes(Object.values(r.mapping)[0]!), true)
    assert.equal(r.redacted.includes(`[${kind}_`), true, `expected [${kind}_] in: ${r.redacted}`)
    assert.equal(/\b[A-Za-z0-9._%+-]+@/.test(r.redacted) && kind === 'EMAIL' ? false : true, true)
  }
})

test('round-trips exactly (no leak, no loss)', () => {
  const text = 'Contact john@acme.com or call 555-123-4567; key sk-abcdefghijklmnopqrstuv'
  const r = redact(text)
  assert.equal(r.redacted.includes('john@acme.com'), false, 'email must not survive redaction')
  assert.equal(r.redacted.includes('sk-abcdefghijklmnopqrstuv'), false, 'api key must not survive')
  assert.equal(unredact(r.redacted, r.mapping), text, 'unredact must restore the original exactly')
})

test('identical values share one placeholder', () => {
  const r = redact('a@b.com and again a@b.com and a@b.com')
  assert.equal(Object.keys(r.mapping).length, 1, 'one distinct value → one placeholder')
  assert.equal((r.redacted.match(/\[EMAIL_1\]/g) ?? []).length, 3)
})

test('redactMany shares a namespace without collisions across messages', () => {
  const r = redactMany(['email x@a.com', 'email y@b.com', 'email x@a.com again'])
  // two distinct emails → two placeholders; the repeated one reuses its placeholder
  assert.equal(Object.keys(r.mapping).length, 2)
  assert.equal(r.redacted[0]!.includes('[EMAIL_1]'), true)
  assert.equal(r.redacted[2]!.includes('[EMAIL_1]'), true, 'same value reuses placeholder across messages')
  assert.notEqual(r.mapping['[EMAIL_1]'], r.mapping['[EMAIL_2]'], 'distinct values never collide on a placeholder')
})

test('policy: disabled categories pass through, custom terms are masked', () => {
  const r1 = redactMany(['ip 10.0.0.1 email a@b.com'], { disabled: ['IP'] })
  assert.equal(r1.redacted[0]!.includes('10.0.0.1'), true, 'disabled IP should pass through')
  assert.equal(r1.redacted[0]!.includes('a@b.com'), false, 'email still masked')
  const r2 = redactMany(['the ProjectNimbus launch'], { terms: ['ProjectNimbus'] })
  assert.equal(r2.redacted[0]!.includes('ProjectNimbus'), false, 'custom term must be masked')
  assert.equal(r2.redacted[0]!.includes('[CUSTOM_1]'), true)
})

test('empty/clean input is a no-op', () => {
  assert.equal(redact('').count, 0)
  assert.equal(redact('just plain words here').count, 0)
  assert.equal(unredact('nothing to restore', {}), 'nothing to restore')
})

// savePolicy persists + caches; loadPolicy returns it; redactMany(texts, loadPolicy()) applies it —
// the exact flow generateSovereign uses before cloud egress.
test('savePolicy → loadPolicy → redactMany applies the saved policy', () => {
  savePolicy({ disabled: ['IP'], terms: ['Acme'] })
  const policy = loadPolicy()
  assert.deepEqual(policy.disabled, ['IP'])
  assert.deepEqual(policy.terms, ['Acme'])
  const r = redactMany(['Acme at 10.0.0.1'], policy)
  assert.equal(r.redacted[0]!.includes('Acme'), false, 'saved custom term must be masked')
  assert.equal(r.redacted[0]!.includes('10.0.0.1'), true, 'saved disabled category passes through')
  savePolicy({ disabled: [], terms: [] })  // restore default (redact-all)
})
