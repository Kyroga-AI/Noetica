import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { migrateJSONLToSQLite } from './sqlite-backend.js'
import type { SQLiteAtomSpaceBackend } from './sqlite-backend.js'

// A minimal fake backend — migrate only needs isEmpty() + write(); we don't need real bun:sqlite to test the
// residue-cleanup decision.
function fakeBackend(empty: boolean) {
  const written: unknown[] = []
  return { written, b: { isEmpty: () => empty, write: (e: unknown) => written.push(e) } as unknown as SQLiteAtomSpaceBackend }
}
const tmpWal = (data: string) => { const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wal-')), 'residue.jsonl'); fs.writeFileSync(p, data); return p }

test('migrates entries to SQLite AND deletes the plaintext WAL residue', () => {
  const wal = tmpWal([
    JSON.stringify({ op: 'add_atom', seq: 1, ts: 1, payload: { handle: 'h1', type: 'Node' } }),
    JSON.stringify({ op: 'add_atom', seq: 2, ts: 2, payload: { handle: 'h2', type: 'Node' } }),
  ].join('\n') + '\n')
  const { written, b } = fakeBackend(true)
  try {
    const n = migrateJSONLToSQLite(b, wal)
    assert.equal(n, 2, 'migrated both entries')
    assert.equal(written.length, 2, 'wrote both to the (encrypted) SQLite backend')
    assert.equal(fs.existsSync(wal), false, 'plaintext WAL deleted after a clean migration')
  } finally { try { fs.rmSync(path.dirname(wal), { recursive: true, force: true }) } catch { /* */ } }
})

test('does NOT delete the WAL when SQLite already has atoms (no migration)', () => {
  const wal = tmpWal(JSON.stringify({ op: 'add_atom', seq: 1, ts: 1, payload: { handle: 'h', type: 'Node' } }) + '\n')
  const { b } = fakeBackend(false)   // non-empty → skip
  try {
    assert.equal(migrateJSONLToSQLite(b, wal), 0)
    assert.equal(fs.existsSync(wal), true, 'WAL kept untouched when nothing migrated')
  } finally { try { fs.rmSync(path.dirname(wal), { recursive: true, force: true }) } catch { /* */ } }
})

test('no-op + no delete when the WAL does not exist', () => {
  const { b } = fakeBackend(true)
  assert.equal(migrateJSONLToSQLite(b, path.join(os.tmpdir(), `nope-${Date.now()}.jsonl`)), 0)
})
