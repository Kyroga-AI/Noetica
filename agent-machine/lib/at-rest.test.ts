// Never touch a real macOS keychain from tests — pin the key to the file path everywhere.
process.env['NOETICA_AT_REST_KEYCHAIN'] = '0'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { encryptLine, decryptLine, appendJsonl, readJsonl, writeJson, readJson } from './at-rest.js'

test('round-trips a record through encrypt/decrypt', () => {
  const obj = { input: 'who is Baxter', coverage: 0.3, nested: { a: [1, 2, 3] } }
  const line = encryptLine(obj)
  assert.ok(line.startsWith('enc:v1:'), 'ciphertext carries the magic prefix')
  assert.ok(!line.includes('Baxter'), 'plaintext is not visible in the ciphertext')
  assert.deepEqual(decryptLine(line), obj)
})

test('plaintext lines pass through (lazy migration of existing files)', () => {
  assert.deepEqual(decryptLine('{"old":"plaintext record"}'), { old: 'plaintext record' })
  assert.equal(decryptLine(''), null)
  assert.equal(decryptLine('not json at all'), null)
})

test('a tampered ciphertext fails closed (GCM auth) → null, not garbage', () => {
  const line = encryptLine({ secret: 'value' })
  // Flip a character in the base64 body.
  const body = line.slice('enc:v1:'.length)
  const tampered = 'enc:v1:' + (body[10] === 'A' ? 'B' : 'A') + body.slice(1)
  assert.equal(decryptLine(tampered), null)
})

test('appendJsonl + readJsonl over a MIXED plaintext/encrypted file', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'at-rest-test-')), 'store.jsonl')
  try {
    // Simulate an existing plaintext file, then append encrypted records.
    fs.writeFileSync(f, `${JSON.stringify({ n: 0, kind: 'legacy-plaintext' })}\n`)
    appendJsonl(f, { n: 1, kind: 'encrypted' })
    appendJsonl(f, { n: 2, kind: 'encrypted' })
    // The on-disk file must NOT contain the plaintext of the encrypted records.
    const raw = fs.readFileSync(f, 'utf8')
    assert.ok(raw.includes('legacy-plaintext'), 'legacy line stays readable')
    assert.ok(!raw.includes('"kind":"encrypted"') || raw.split('\n').filter((l) => l.includes('enc:v1:')).length === 2, 'new records are encrypted on disk')
    const back = readJsonl<{ n: number }>(f)
    assert.deepEqual(back.map((r) => r.n), [0, 1, 2], 'all three records read back, mixed forms')
  } finally { try { fs.rmSync(path.dirname(f), { recursive: true, force: true }) } catch { /* */ } }
})

test('writeJson/readJson whole-file round-trip + encrypted on disk + plaintext fallback', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'at-rest-json-')), 'store.json')
  try {
    const obj = { runs: [{ id: 'r1', prompt: 'SENSITIVE-governance-content' }], n: 1 }
    writeJson(f, obj)
    assert.ok(!fs.readFileSync(f, 'utf8').includes('SENSITIVE-governance-content'), 'sensitive content not plaintext on disk')
    assert.deepEqual(readJson(f), obj, 'decrypts back identically')
    // Lazy migration: a legacy plaintext whole-file JSON still reads.
    fs.writeFileSync(f, JSON.stringify({ legacy: true }))
    assert.deepEqual(readJson(f), { legacy: true })
  } finally { try { fs.rmSync(path.dirname(f), { recursive: true, force: true }) } catch { /* */ } }
})
