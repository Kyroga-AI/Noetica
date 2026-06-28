import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encryptLine, decryptLine } from './at-rest.js'

// build-corpus.packShard writes each shard line via encryptLine; study-brain reads via decryptLine. This pins the
// round-trip + the security property + lazy plaintext migration with a real brain-shard payload (text + vec).
test('brain shard: encrypted on disk (no plaintext text/vec leak), decrypts on read', () => {
  const shard = { slug: 'mit-ocw-1', field: 'mathematics', material: 'lecture', text: 'CONFIDENTIAL lecture notes on eigenvalues', dims: 4, vec: 'q83vPwAAAAA=' }
  const line = encryptLine(shard)            // what build-corpus writes
  assert.ok(line.startsWith('enc:v1:'), 'shard line is ciphertext on disk')
  assert.ok(!line.includes('CONFIDENTIAL'), 'the text is not plaintext on disk')
  assert.ok(!line.includes('q83vP'), 'the base64 vector is not plaintext on disk (vec2text protection)')
  assert.deepEqual(decryptLine(line), shard, 'study-brain read recovers the shard identically')
})

test('legacy plaintext shards still load (lazy migration — shipped/old corpora)', () => {
  const shard = { slug: 's', text: 'public manpage', vec: 'AAAAAA==', dims: 2 }
  assert.deepEqual(decryptLine(JSON.stringify(shard)), shard)
  assert.equal(decryptLine('not a shard line'), null, 'junk → null (skipped by the loader, not a crash)')
})
