/** Tests for the shared JSONL reader. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { readJsonl } from './jsonl.js'

test('reads line-delimited JSON, skipping blank lines', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-')), 'log.jsonl')
  fs.writeFileSync(f, '{"a":1}\n\n{"a":2}\n')
  const out = readJsonl<{ a: number }>(f)
  assert.deepEqual(out.map((x) => x.a), [1, 2])
})

test('limit tail-slices to the most-recent N', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-')), 'log.jsonl')
  fs.writeFileSync(f, [1, 2, 3, 4, 5].map((n) => JSON.stringify({ n })).join('\n') + '\n')
  assert.deepEqual(readJsonl<{ n: number }>(f, { limit: 2 }).map((x) => x.n), [4, 5])
})

test('missing file → [] (no throw)', () => {
  assert.deepEqual(readJsonl('/no/such/file.jsonl'), [])
})

test('a malformed line is skipped, good lines survive (per-line parse, no whole-ledger loss)', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-')), 'log.jsonl')
  fs.writeFileSync(f, '{"a":1}\n{not json}\n{"a":2}\n')
  // The old reader did `sliced.map(JSON.parse)` → one bad line threw → catch → [] (the ledger vanished).
  // The per-line reader keeps every parseable record and just skips the corrupt one.
  assert.deepEqual(readJsonl<{ a: number }>(f).map((x) => x.a), [1, 2])
})
