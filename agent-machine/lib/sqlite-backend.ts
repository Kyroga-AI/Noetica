/**
 * SQLiteAtomSpaceBackend — RocksDB-class persistence for AtomSpace using bun:sqlite.
 *
 * Architecture: atoms table holds current state (upsertable, indexed by type + name).
 * Restore is a snapshot read — O(n atoms), not O(n log entries). Atomic batch support
 * via SQLite transactions. WAL mode gives concurrent readers without contention.
 *
 * Maps directly to the OpenCog rocks-storage-node role: durable, compactable,
 * fast O(log n) lookups by handle/type/name. Ready for distributed deployment via
 * the StorageNode HTTP API that wraps this backend.
 */

import type {
  AtomSpaceBackend, AtomLogEntry, AtomLogOp,
  Handle, TruthValue, AttentionValue, Value,
} from '@socioprophet/hellgraph'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { encryptLine, decryptLine } from './at-rest.js'

// Atom VALUES (vals_json) hold the sensitive payload — document text + embeddings (a plaintext vector is ~92%
// invertible to its source text via vec2text). vals_json is an OPAQUE blob keyed by handle (never content-
// queried), so we encrypt it at rest + decrypt on read: hellgraph's similarity search sees plaintext in memory,
// the disk holds ciphertext. Lazy migration — decryptLine passes through any legacy plaintext '{}' / JSON.
const ATR_ON = (): boolean => process.env['NOETICA_ENCRYPT_AT_REST'] !== '0'
/** Serialize atom values for storage — encrypted at rest by default (the disk form). Exported for tests. */
export const packVals = (vals: Record<string, unknown>): string => (ATR_ON() ? encryptLine(vals) : JSON.stringify(vals))
/** Deserialize stored atom values — decrypts, with legacy-plaintext passthrough. Exported for tests. */
export const unpackVals = (s: string): Record<string, Value> => (decryptLine(s) as Record<string, Value> | null) ?? {}

// ─── Minimal bun:sqlite interface (avoid hard dep on @types/bun) ─────────────

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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('bun:sqlite') as { Database: DatabaseCtor }
    return mod.Database
  } catch {
    return null
  }
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;
PRAGMA cache_size=-32000;

CREATE TABLE IF NOT EXISTS atoms (
  handle      TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  name        TEXT,
  outgoing    TEXT,
  tv_strength REAL,
  tv_conf     REAL,
  av_sti      REAL NOT NULL DEFAULT 0,
  av_lti      REAL NOT NULL DEFAULT 0,
  av_vlti     INTEGER NOT NULL DEFAULT 0,
  vals_json   TEXT NOT NULL DEFAULT '{}',
  seq         INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_type ON atoms(type);
CREATE INDEX IF NOT EXISTS idx_node ON atoms(type, name) WHERE name IS NOT NULL;
`

// ─── SQLiteAtomSpaceBackend ───────────────────────────────────────────────────

interface DbRow {
  handle: string; type: string; name: string | null; outgoing: string | null
  tv_strength: number | null; tv_conf: number | null
  av_sti: number; av_lti: number; av_vlti: number
  vals_json: string; seq: number; created_at: string
}

// Write-only "exhaust" that dominates atom count on a real install: per-tool-call decision-ledger fields
// (urn:regis:decision:… , one ConceptNode PER tool argument) + session/interaction episodes. Never
// graph-queried (governance reads the ledger from a FILE), filtered from every surface (graph-surface
// isExhaust), yet ~72% of a 1M-atom graph. We DON'T hydrate it into the hot in-memory graph at boot —
// SQLite keeps everything, but skipping it makes hydration ~4× faster. KEEP IN SYNC with scripts/compact-graph.mjs.
const EXHAUST_HYDRATE_PREFIXES = ['urn:regis:decision:', 'urn:noetica:session:', 'urn:noetica:interaction:']

/**
 * Referentially-closed exhaust set: seed with exhaust ConceptNodes (by name prefix), then transitively add
 * every atom whose `outgoing` references an exhaust handle (links → links → nodes) until fixpoint. Because the
 * set is closed, NO kept atom is left with a dangling reference — so skipping the whole set at hydration can
 * never corrupt the in-memory graph (this is the same closure the compaction tool verifies gives 0 dangling).
 */
function computeHydrationExhaust(rows: DbRow[]): Set<string> {
  const exhaust = new Set<string>()
  const outMap = new Map<string, string[]>()
  for (const r of rows) {
    const out = r.outgoing ? (JSON.parse(r.outgoing) as string[]) : []
    outMap.set(r.handle, out)
    if (r.type === 'ConceptNode' && r.name && EXHAUST_HYDRATE_PREFIXES.some((p) => r.name!.startsWith(p))) exhaust.add(r.handle)
  }
  let changed = true
  while (changed) {
    changed = false
    for (const r of rows) {
      if (exhaust.has(r.handle)) continue
      const out = outMap.get(r.handle)!
      for (let i = 0; i < out.length; i++) { if (exhaust.has(out[i]!)) { exhaust.add(r.handle); changed = true; break } }
    }
  }
  return exhaust
}

export class SQLiteAtomSpaceBackend implements AtomSpaceBackend {
  private db: SQLiteDatabase
  private readonly dbPath: string

  private stmtInsert!:       SQLiteStatement
  private stmtUpdateTV!:     SQLiteStatement
  private stmtUpdateAV!:     SQLiteStatement
  private stmtGetVals!:      SQLiteStatement
  private stmtUpdateVals!:   SQLiteStatement
  private stmtSelectAll!:    SQLiteStatement
  private stmtCount!:        SQLiteStatement

  constructor(Database: DatabaseCtor, dbPath: string) {
    this.dbPath = dbPath
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.exec(SCHEMA)
    this.prepare()
  }

  private prepare(): void {
    this.stmtInsert = this.db.prepare(`
      INSERT OR IGNORE INTO atoms
        (handle,type,name,outgoing,tv_strength,tv_conf,av_sti,av_lti,av_vlti,vals_json,seq,created_at)
      VALUES (?,?,?,?,?,?,0,0,0,'{}',?,?)
    `)
    this.stmtUpdateTV   = this.db.prepare(`UPDATE atoms SET tv_strength=?,tv_conf=? WHERE handle=?`)
    this.stmtUpdateAV   = this.db.prepare(`UPDATE atoms SET av_sti=?,av_lti=?,av_vlti=? WHERE handle=?`)
    this.stmtGetVals    = this.db.prepare(`SELECT vals_json FROM atoms WHERE handle=?`)
    this.stmtUpdateVals = this.db.prepare(`UPDATE atoms SET vals_json=? WHERE handle=?`)
    this.stmtSelectAll  = this.db.prepare(`SELECT * FROM atoms ORDER BY seq`)
    this.stmtCount      = this.db.prepare(`SELECT COUNT(*) as n FROM atoms`)
  }

  // ─── AtomSpaceBackend impl ─────────────────────────────────────────────────

  write(entry: AtomLogEntry): void {
    const p = entry.payload
    switch (entry.op as AtomLogOp) {
      case 'add_atom': {
        const tv = p['tv'] as TruthValue | undefined
        this.stmtInsert.run(
          p['handle'], p['type'],
          (p['name'] as string | undefined) ?? null,
          p['outgoing'] ? JSON.stringify(p['outgoing']) : null,
          tv?.strength ?? null,
          tv?.confidence ?? null,
          entry.seq,
          entry.ts,
        )
        break
      }
      case 'set_tv': {
        const tv = p['tv'] as TruthValue
        this.stmtUpdateTV.run(tv.strength, tv.confidence, p['handle'])
        break
      }
      case 'set_av': {
        const av = p['av'] as AttentionValue
        this.stmtUpdateAV.run(av.sti, av.lti, av.vlti, p['handle'])
        break
      }
      case 'set_value': {
        const row = this.stmtGetVals.get(p['handle']) as { vals_json: string } | undefined
        if (row) {
          const vals = unpackVals(row.vals_json)
          vals[p['key'] as string] = p['value'] as Value
          this.stmtUpdateVals.run(packVals(vals), p['handle'])
        }
        break
      }
    }
  }

  restore(apply: (entry: AtomLogEntry) => void): void {
    const rows = this.stmtSelectAll.all() as DbRow[]
    // Skip hydrating write-only exhaust into the hot graph (automatic + safe; SQLite retains it).
    const skip = process.env['NOETICA_HYDRATE_EXHAUST'] === '1' ? new Set<string>() : computeHydrationExhaust(rows)
    let skipped = 0
    for (const row of rows) {
      if (skip.has(row.handle)) { skipped++; continue }
      const tv = row.tv_strength !== null
        ? { strength: row.tv_strength, confidence: row.tv_conf! }
        : undefined
      const av = row.av_sti || row.av_lti || row.av_vlti
        ? { sti: row.av_sti, lti: row.av_lti, vlti: row.av_vlti }
        : undefined

      apply({
        seq: row.seq, ts: row.created_at, op: 'add_atom',
        payload: {
          handle: row.handle, type: row.type,
          name: row.name ?? undefined,
          outgoing: row.outgoing ? JSON.parse(row.outgoing) as Handle[] : undefined,
          tv, av,
        },
      })

      // Restore values as separate set_value entries (applyLogEntry needs atom indexed first)
      const vals = unpackVals(row.vals_json)
      for (const [key, value] of Object.entries(vals)) {
        apply({ seq: row.seq, ts: row.created_at, op: 'set_value', payload: { handle: row.handle, key, value } })
      }
    }
    if (skipped > 0) console.log(`[atomspace] skipped hydrating ${skipped.toLocaleString()} write-only exhaust atoms (retained in SQLite; NOETICA_HYDRATE_EXHAUST=1 to load all)`)
  }

  storagePath(): string { return this.dbPath }

  isEmpty(): boolean {
    const row = this.stmtCount.get() as { n: number }
    return row.n === 0
  }

  atomCount(): number {
    const row = this.stmtCount.get() as { n: number }
    return row.n
  }

  close(): void { this.db.close() }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

// NOETICA_HELLGRAPH_DB overrides the graph DB path (testing a compacted graph, an alternate graph, etc.).
export const DEFAULT_SQLITE_PATH = process.env['NOETICA_HELLGRAPH_DB'] || path.join(
  os.homedir(), '.noetica', 'hellgraph', 'sociosphere-primary.sqlite',
)

export const DEFAULT_JSONL_PATH = path.join(
  os.homedir(), '.noetica', 'hellgraph', 'sociosphere-primary.atomspace.jsonl',
)

/**
 * Creates a SQLiteAtomSpaceBackend if bun:sqlite is available.
 * Returns null when running in Node.js/tsx (dev/test mode) — caller falls back to JSONL.
 */
export function createSQLiteBackend(dbPath = DEFAULT_SQLITE_PATH): SQLiteAtomSpaceBackend | null {
  const Database = loadBunSQLite()
  if (!Database) return null
  return new SQLiteAtomSpaceBackend(Database, dbPath)
}

/**
 * Migrate existing JSONL WAL entries into the SQLite backend.
 * No-op if JSONL doesn't exist or SQLite already has atoms.
 */
export function migrateJSONLToSQLite(backend: SQLiteAtomSpaceBackend, jsonlPath = DEFAULT_JSONL_PATH): number {
  if (!backend.isEmpty()) return 0
  if (!fs.existsSync(jsonlPath)) return 0
  let count = 0
  let cleanRead = false
  try {
    const raw = fs.readFileSync(jsonlPath, 'utf-8')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t) continue
      try {
        backend.write(JSON.parse(t) as AtomLogEntry)
        count++
      } catch { /* skip corrupt entry */ }
    }
    cleanRead = true
  } catch { /* file read error */ }
  // Remove the plaintext-WAL residue: after a clean migration its atoms (document text + embeddings) now live
  // ENCRYPTED in SQLite (the writes above), and the caller switches the live backend to SQLite, so hellgraph
  // won't recreate it. Leaving the plaintext .atomspace.jsonl on disk would re-open the at-rest gap we just
  // closed (#257). Guarded: only when the whole file read cleanly AND ≥1 entry migrated.
  if (cleanRead && count > 0) {
    try { fs.rmSync(jsonlPath) } catch { /* best-effort; SQLite already holds the data */ }
  }
  return count
}
