import { test } from 'node:test'
import assert from 'node:assert/strict'
import { packVals, unpackVals } from './sqlite-backend.js'

// The on-disk form of an atom's values must NOT leak the embedding (vec2text-invertible) or text in plaintext.
test('packVals encrypts embeddings + text on disk; unpackVals round-trips', () => {
  const vals = { embedding: [0.1234, -0.5678, 0.9012], text: 'CONFIDENTIAL document chunk', filename: 'secret.pdf' }
  const stored = packVals(vals)
  assert.ok(stored.startsWith('enc:v1:'), 'stored as ciphertext')
  assert.ok(!stored.includes('CONFIDENTIAL'), 'text not plaintext on disk')
  assert.ok(!stored.includes('0.1234'), 'embedding floats not plaintext on disk')
  assert.deepEqual(unpackVals(stored), vals, 'decrypts back identically (search sees plaintext in memory)')
})

test('unpackVals passes through legacy plaintext vals_json (lazy migration)', () => {
  assert.deepEqual(unpackVals('{"text":"legacy plaintext"}'), { text: 'legacy plaintext' })
  assert.deepEqual(unpackVals('{}'), {})   // the INSERT default
})

test('NOETICA_ENCRYPT_AT_REST=0 stores plaintext (portability/debug escape hatch)', () => {
  const prev = process.env['NOETICA_ENCRYPT_AT_REST']
  process.env['NOETICA_ENCRYPT_AT_REST'] = '0'
  try {
    const stored = packVals({ text: 'plain' })
    assert.equal(stored, '{"text":"plain"}')
    assert.deepEqual(unpackVals(stored), { text: 'plain' })
  } finally { if (prev === undefined) delete process.env['NOETICA_ENCRYPT_AT_REST']; else process.env['NOETICA_ENCRYPT_AT_REST'] = prev }
})
