/** Tests for chat secret detection/redaction (secret hygiene layer). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectSecrets, redactSecrets } from './secretPatterns'

const ANT = 'sk-ant-api03-' + 'a'.repeat(80) + 'QAA'

test('finds an Anthropic key and classifies it as anthropic (not generic openai sk-)', () => {
  const hits = detectSecrets(`here is my key ${ANT} thanks`)
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.kind, 'anthropic')
  assert.equal(hits[0]!.last4, ANT.slice(-4))
})

test('finds github + aws + slack tokens', () => {
  const text = [
    'ghp_' + 'B'.repeat(36),
    'AKIA' + 'Q'.repeat(16),
    'xoxb-1234567890-abcdefghij',
  ].join(' and ')
  assert.deepEqual(detectSecrets(text).map((h) => h.kind).sort(), ['aws', 'github', 'slack'])
})

test('finds a PEM private key block', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----'
  assert.deepEqual(detectSecrets(pem).map((h) => h.kind), ['private-key'])
})

test('does NOT flag ordinary prose, sha256 digests, or short sk- fragments', () => {
  assert.equal(detectSecrets('the sky is blue and skiing is fun').length, 0)
  assert.equal(detectSecrets('digest: ' + 'ab'.repeat(32)).length, 0)   // 64-hex is NOT a secret pattern
  assert.equal(detectSecrets('use sk-test as a placeholder').length, 0)
})

test('does not double-claim overlapping spans', () => {
  // The anthropic pattern must claim the span before the generic openai pattern sees it.
  assert.equal(detectSecrets(ANT).length, 1)
})

test('redacts with an inert marker keeping the last 4 chars', () => {
  const out = redactSecrets(`key: ${ANT} — use it`)
  assert.ok(!out.includes('sk-ant-api03'))
  assert.ok(out.includes('[redacted anthropic key …' + ANT.slice(-4) + ']'))
  assert.ok(out.includes('— use it'))
})

test('handles multiple secrets and preserves surrounding text order', () => {
  const gh = 'ghp_' + 'D'.repeat(36)
  const out = redactSecrets(`a ${ANT} b ${gh} c`)
  assert.equal(out.indexOf('a '), 0)
  assert.ok(out.includes('[redacted anthropic key'))
  assert.ok(out.includes('[redacted github key'))
  assert.ok(out.endsWith(' c'))
})

test('is a no-op on clean text', () => {
  assert.equal(redactSecrets('hello world'), 'hello world')
})
