import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { putBlob, getBlob, hasBlob, blobPath } from './blob-store.js'

process.env['NOETICA_BLOB_DIR'] = mkdtempSync(join(tmpdir(), 'noetica-blob-'))   // lazy dir → set before first use

test('putBlob is content-addressed + idempotent', () => {
  const a = putBlob('hello world')
  assert.equal(a.stored, true)
  assert.equal(a.size, 11)
  const b = putBlob('hello world')          // same content
  assert.equal(b.hash, a.hash)              // same hash
  assert.equal(b.stored, false)             // not re-written
  const c = putBlob('different')
  assert.notEqual(c.hash, a.hash)
})

test('getBlob round-trips the exact bytes', () => {
  const buf = Buffer.from([0x25, 0x50, 0x44, 0x46])   // "%PDF" — binary, not text
  const ref = putBlob(buf)
  assert.ok(hasBlob(ref.hash))
  assert.deepEqual(getBlob(ref.hash), buf)
  assert.equal(getBlob('deadbeef'.repeat(8)), null)   // absent → null
})

test('blobPath shards by first byte', () => {
  const ref = putBlob('shard me')
  assert.ok(blobPath(ref.hash).includes(`/${ref.hash.slice(0, 2)}/`))
})
