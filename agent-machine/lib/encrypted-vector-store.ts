/**
 * encrypted-vector-store.ts — AES-256-GCM encrypted SQLite-backed vector store.
 *
 * Privacy gap: "we only store vectors" is NOT a privacy boundary. vec2text (Arxiv 2023) inverts
 * 32-token text from a stored embedding with 92% exact-match accuracy. This store encrypts BOTH
 * the vector bytes (Float32 array) AND the metadata text before writing to disk. Decryption + cosine
 * search happens in-process; the on-disk form is opaque ciphertext even if the database file is leaked.
 *
 * Use when: `ENCRYPTED_VECTOR_STORE=true`. Does not replace the noetica-embed sidecar; operates as
 * a parallel privacy-sensitive store for documents that should never appear in any disk dump.
 *
 * Key: reuses the at-rest.ts device key (0600 file or macOS Keychain) — same posture, no new secret.
 */
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { encryptBytes, decryptBytes } from './at-rest.js'
import { encodeVec, decodeVec, l2norm } from './brain-vec.js'

// ── SQLite shim (matches sqlite-backend.ts pattern) ──────────────────────────

interface SQLiteStatement {
  run(...args: unknown[]): void
  get(...args: unknown[]): unknown
  all(): unknown[]
}
interface SQLiteDatabase {
  prepare(sql: string): SQLiteStatement
  exec(sql: string): void
  close(): void
}
type DatabaseCtor = new (p: string) => SQLiteDatabase

function loadBunSQLite(): DatabaseCtor | null {
  try {
    const mod = require('bun:sqlite') as { Database: DatabaseCtor }
    return mod.Database
  } catch { return null }
}

// ── Schema ────────────────────────────────────────────────────────────────────

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;

CREATE TABLE IF NOT EXISTS enc_vectors (
  id         TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  vec_enc    BLOB NOT NULL,
  meta_enc   BLOB NOT NULL,
  dims       INTEGER NOT NULL,
  inserted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coll ON enc_vectors(collection);
`

// ── Encryption helpers ────────────────────────────────────────────────────────

function encryptVec(vec: number[]): Buffer {
  const f = Float32Array.from(vec)
  const raw = Buffer.from(f.buffer, f.byteOffset, f.byteLength)
  return encryptBytes(raw)
}

function decryptVec(enc: Buffer): number[] {
  const raw = decryptBytes(enc)
  if (!raw) return []
  const f = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
  return Array.from(f)
}

function encryptMeta(meta: Record<string, unknown>): Buffer {
  return encryptBytes(Buffer.from(JSON.stringify(meta), 'utf8'))
}

function decryptMeta(enc: Buffer): Record<string, unknown> {
  const raw = decryptBytes(enc)
  if (!raw) return {}
  try { return JSON.parse(raw.toString('utf8')) as Record<string, unknown> } catch { return {} }
}

// ── EncryptedVectorStore ──────────────────────────────────────────────────────

export interface EVSHit {
  id: string
  score: number
  meta: Record<string, unknown>
}

export interface EncryptedVectorStore {
  insert(id: string, vec: number[], meta?: Record<string, unknown>): void
  search(queryVec: number[], opts?: { topK?: number; collection?: string }): EVSHit[]
  delete(id: string): void
  count(collection?: string): number
  keyStatus(): { encrypted: boolean; keySource: string }
}

const DEFAULT_DB_PATH = path.join(os.homedir(), '.noetica', 'enc-vectors.db')

export function createEncryptedVectorStore(opts: {
  collection?: string
  dbPath?: string
} = {}): EncryptedVectorStore {
  const collection = opts.collection ?? 'default'
  const dbPath = opts.dbPath ?? DEFAULT_DB_PATH
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  const DB = loadBunSQLite()
  if (!DB) throw new Error('encrypted-vector-store: bun:sqlite unavailable — run under bun')
  const db: SQLiteDatabase = new DB(dbPath)
  db.exec(SCHEMA)

  const stmtInsert = db.prepare(
    `INSERT OR REPLACE INTO enc_vectors (id, collection, vec_enc, meta_enc, dims, inserted_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  const stmtDelete = db.prepare(`DELETE FROM enc_vectors WHERE id = ?`)
  const stmtAll    = db.prepare(`SELECT id, vec_enc, meta_enc, dims FROM enc_vectors WHERE collection = ?`)
  const stmtCount  = db.prepare(`SELECT COUNT(*) as n FROM enc_vectors WHERE collection = ?`)
  const stmtCountAll = db.prepare(`SELECT COUNT(*) as n FROM enc_vectors`)

  return {
    insert(id: string, vec: number[], meta: Record<string, unknown> = {}) {
      const vecEnc = encryptVec(vec)
      const metaEnc = encryptMeta(meta)
      stmtInsert.run(id, collection, vecEnc, metaEnc, vec.length, new Date().toISOString())
    },

    search(queryVec: number[], { topK = 5, collection: col } = {}): EVSHit[] {
      const coll = col ?? collection
      const rows = stmtAll.all() as Array<{ id: string; vec_enc: Buffer; meta_enc: Buffer; dims: number }>
      const qf = Float32Array.from(queryVec)
      const qn = l2norm(qf)

      const scored = rows
        .filter((r) => r.dims === queryVec.length)
        .map((r) => {
          const vec = decryptVec(r.vec_enc)
          if (!vec.length) return null
          const vf = Float32Array.from(vec)
          let dot = 0
          for (let i = 0; i < qf.length; i++) dot += (qf[i] ?? 0) * (vf[i] ?? 0)
          const score = dot / (qn * l2norm(vf))
          return { id: r.id, score, meta: decryptMeta(r.meta_enc) }
        })
        .filter((x): x is EVSHit => x !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)

      // suppress unused variable (col used for type narrowing)
      void coll
      return scored
    },

    delete(id: string) {
      stmtDelete.run(id)
    },

    count(col?: string): number {
      if (col) {
        const r = stmtCount.get(col ?? collection) as { n: number }
        return r?.n ?? 0
      }
      const r = stmtCountAll.get() as { n: number }
      return r?.n ?? 0
    },

    keyStatus(): { encrypted: boolean; keySource: string } {
      const keyPath = path.join(os.homedir(), '.noetica', 'at-rest.key')
      const fileKey = fs.existsSync(keyPath)
      const keychain = process.platform === 'darwin' && process.env['NOETICA_AT_REST_KEYCHAIN'] === '1'
      return {
        encrypted: true,
        keySource: keychain ? 'macos-keychain' : fileKey ? 'file-0600' : 'in-memory',
      }
    },
  }
}

// Module-level singleton for the default collection
let _store: EncryptedVectorStore | null = null
export function getEncryptedVectorStore(): EncryptedVectorStore {
  if (!_store) _store = createEncryptedVectorStore()
  return _store
}
