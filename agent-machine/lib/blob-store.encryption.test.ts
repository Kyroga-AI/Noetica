import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { putBlob, getBlob, blobPath } from './blob-store.js'

// blobDir() reads NOETICA_BLOB_DIR lazily (at call time), so setting it here — before any test body runs —
// redirects the store to a temp dir.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noetica-blobs-'))
process.env['NOETICA_BLOB_DIR'] = dir

test('uploaded bytes are encrypted on disk + round-trip; content-hash stays by plaintext (dedup works)', () => {
  const pdf = Buffer.from('%PDF-1.7\nCONFIDENTIAL contract: acquisition terms and the purchase price.\n%%EOF')
  const ref = putBlob(pdf)
  assert.equal(ref.stored, true)

  // On disk: NOT plaintext (no "CONFIDENTIAL"), and carries the binary at-rest magic.
  const onDisk = fs.readFileSync(blobPath(ref.hash))
  assert.ok(!onDisk.includes(Buffer.from('CONFIDENTIAL')), 'plaintext not on disk')
  assert.ok(onDisk.subarray(0, 8).equals(Buffer.from('NoetEnc\x01', 'latin1')), 'blob carries the at-rest magic')

  // getBlob decrypts back to the exact original bytes.
  assert.deepEqual(getBlob(ref.hash), pdf)

  // Idempotency: same content → same hash (hash is over PLAINTEXT) → second store is a no-op.
  const ref2 = putBlob(pdf)
  assert.equal(ref2.hash, ref.hash)
  assert.equal(ref2.stored, false)
})

test('legacy plaintext blobs still read (lazy migration)', () => {
  // Simulate an old, pre-encryption blob written directly (no magic).
  const data = Buffer.from('legacy plaintext blob bytes')
  const hash = createHash('sha256').update(data).digest('hex')
  const p = blobPath(hash)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, data)   // plaintext, no magic
  assert.deepEqual(getBlob(hash), data, 'a legacy plaintext blob passes through on read')
})

process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* */ } })
