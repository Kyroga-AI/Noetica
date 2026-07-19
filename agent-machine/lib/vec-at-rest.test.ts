// Never touch a real macOS keychain from tests — pin the at-rest key to the file path.
process.env['NOETICA_AT_REST_KEYCHAIN'] = '0'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeVecEncrypted, decodeVecEncrypted } from './vec-at-rest.js'
import { encodeVec } from './brain-vec.js'

test('encrypted vector round-trips (ciphertext at rest, exact plaintext back)', () => {
  const v = [0.1, -0.5, 0.9, 0.3, -0.2, 1.5]
  const enc = encodeVecEncrypted(v)
  assert.ok(enc.startsWith('enc:v1:'))                       // ciphertext on disk
  const dec = Array.from(decodeVecEncrypted(enc))
  assert.equal(dec.length, v.length)
  for (let i = 0; i < v.length; i++) assert.ok(Math.abs(dec[i]! - v[i]!) < 1e-6)
})

test('decode lazily migrates legacy plaintext base64', () => {
  const plain = encodeVec([1, 2, 3])                          // legacy plaintext form
  assert.ok(!plain.startsWith('enc:v1:'))
  assert.deepEqual(Array.from(decodeVecEncrypted(plain)).map((x) => Math.round(x)), [1, 2, 3])
})

test('NOETICA_ENCRYPT_VECTORS=0 stores plaintext (opt-out), still decodes', () => {
  process.env['NOETICA_ENCRYPT_VECTORS'] = '0'
  try {
    const enc = encodeVecEncrypted([1, 2, 3])
    assert.ok(!enc.startsWith('enc:v1:'))
    assert.deepEqual(Array.from(decodeVecEncrypted(enc)).map((x) => Math.round(x)), [1, 2, 3])
  } finally {
    delete process.env['NOETICA_ENCRYPT_VECTORS']
  }
})

test('tampered ciphertext → empty vector (no embedding), never throws', () => {
  const enc = encodeVecEncrypted([1, 2, 3])
  const tampered = `${enc.slice(0, -6)}AAAAAA`
  assert.equal(decodeVecEncrypted(tampered).length, 0)
})

import { encryptEmbeddingVal, decryptEmbeddingVal } from './vec-at-rest.js'

test('embedding-val encrypt/decrypt round-trips at the atom-property level', () => {
  const vals = { text: 'a chunk', embedding: JSON.stringify([0.1, 0.2, 0.3]), other: 1 }
  const enc = encryptEmbeddingVal(vals)
  assert.ok((enc.embedding as string).startsWith('enc:v1:'))   // ciphertext in vals_json
  assert.equal(enc.text, 'a chunk')                            // other props untouched
  const dec = decryptEmbeddingVal(enc)
  assert.equal(dec.embedding, JSON.stringify([0.1, 0.2, 0.3])) // exact plaintext back
})

test('embedding-val helpers are idempotent + lazy-migrate + no-op without embedding', () => {
  const plain = { embedding: JSON.stringify([1, 2]) }
  assert.equal(decryptEmbeddingVal(plain).embedding, plain.embedding)   // legacy plaintext passes through
  const enc = encryptEmbeddingVal(plain)
  assert.deepEqual(encryptEmbeddingVal(enc), enc)                        // idempotent (already encrypted)
  assert.deepEqual(encryptEmbeddingVal({ text: 'x' }), { text: 'x' })   // no embedding → unchanged
})
