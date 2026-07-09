#!/usr/bin/env bun
/**
 * compact-graph — offline, SAFE de-bloat of the append-only HellGraph atomspace.
 *
 * The atomspace accumulates write-only "exhaust" forever: per-tool-call decision-ledger atoms
 * (urn:regis:decision:… — one ConceptNode PER tool argument), plus session/interaction episodes.
 * They are never graph-queried (governance reads the decision ledger from a FILE), are filtered out of
 * every surface (graph-surface.ts isExhaust), yet they still HYDRATE into memory at boot — on a real
 * install that's ~85% of a 1M-atom graph and ~15s of cold-start.
 *
 * The SQLite backend (sqlite-backend.ts) is APPEND-ONLY — no DELETE/vacuum — so the safe way to hard-remove
 * exhaust is OFFLINE COMPACTION: identify exhaust ConceptNodes by name prefix, transitively drop every link
 * that references them, VERIFY the kept set is referentially closed (no dangling handles), and write a fresh
 * compacted DB. The original is never mutated in place.
 *
 * Usage (run with bun; STOP the app first if you --swap):
 *   bun agent-machine/scripts/compact-graph.mjs                 # DRY RUN — report only, no writes
 *   bun agent-machine/scripts/compact-graph.mjs --apply         # write <db>.compacted (keeps live DB untouched)
 *   bun agent-machine/scripts/compact-graph.mjs --apply --swap  # + back up the live DB and swap the compacted one in
 *   bun agent-machine/scripts/compact-graph.mjs /path/to.sqlite # target a specific DB
 */
import { Database } from 'bun:sqlite'
import * as fs from 'node:fs'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const SWAP = args.includes('--swap')
const dbPath = args.find((a) => !a.startsWith('--')) || `${process.env.HOME}/.noetica/hellgraph/sociosphere-primary.sqlite`

// Exhaust ConceptNodes, identified by NAME PREFIX. Conservative — only kinds that are provably write-only,
// never graph-read, and already treated as exhaust by graph-surface.ts. Add patterns deliberately, not by guess.
const EXHAUST_PREFIXES = [
  'urn:regis:decision:',      // per-tool-call decision-ledger fields — the dominant bloat
  'urn:noetica:session:',     // session episodes
  'urn:noetica:interaction:', // interaction episodes
]
const isExhaustName = (name) => !!name && EXHAUST_PREFIXES.some((p) => name.startsWith(p))

if (!fs.existsSync(dbPath)) { console.error(`✗ db not found: ${dbPath}`); process.exit(1) }
console.log(`▸ reading ${dbPath}`)
const src = new Database(dbPath, { readonly: true })
const rows = src.query('SELECT handle, type, name, outgoing FROM atoms').all()
console.log(`  ${rows.length.toLocaleString()} atoms`)

// Seed exhaust with the pattern-matched ConceptNodes; index outgoing for the closure.
const exhaust = new Set()
const outMap = new Map()
for (const r of rows) {
  const out = r.outgoing ? JSON.parse(r.outgoing) : []
  outMap.set(r.handle, out)
  if (r.type === 'ConceptNode' && isExhaustName(r.name)) exhaust.add(r.handle)
}
const seedNodes = exhaust.size
console.log(`  seed exhaust ConceptNodes (by prefix): ${seedNodes.toLocaleString()}`)

// Transitive closure: any atom whose outgoing references an exhaust handle is itself exhaust. Links can
// reference links which reference ConceptNodes, so iterate to a fixpoint.
let changed = true, passes = 0
while (changed) {
  changed = false; passes++
  for (const r of rows) {
    if (exhaust.has(r.handle)) continue
    const out = outMap.get(r.handle)
    for (let i = 0; i < out.length; i++) { if (exhaust.has(out[i])) { exhaust.add(r.handle); changed = true; break } }
  }
}
const dropN = exhaust.size, keepN = rows.length - dropN
console.log(`  transitive closure: ${passes} passes → ${dropN.toLocaleString()} exhaust (${seedNodes.toLocaleString()} nodes + ${(dropN - seedNodes).toLocaleString()} links)`)
console.log(`  KEEP ${keepN.toLocaleString()} (${(100 * keepN / rows.length).toFixed(1)}%)   DROP ${dropN.toLocaleString()} (${(100 * dropN / rows.length).toFixed(1)}%)`)

// Integrity: NO kept atom may reference a dropped handle. (Guaranteed by the closure, but verify explicitly —
// this is a destructive-adjacent op, so prove it before trusting it.)
let dangling = 0
for (const r of rows) {
  if (exhaust.has(r.handle)) continue
  for (const h of outMap.get(r.handle)) if (exhaust.has(h)) dangling++
}
if (dangling > 0) { console.error(`  ✗ INTEGRITY FAIL: ${dangling} kept→dropped references — aborting, no writes.`); process.exit(1) }
console.log(`  ✓ integrity: kept set is referentially closed (0 dangling handles)`)

if (!APPLY) {
  console.log('\n▸ DRY RUN — nothing written. Re-run with --apply to write <db>.compacted (and --swap to replace the live DB).')
  process.exit(0)
}

// APPLY — build a fresh compacted DB with only the kept rows (all columns preserved, original order).
const outPath = `${dbPath}.compacted`
for (const p of [outPath, `${outPath}-wal`, `${outPath}-shm`]) { try { fs.rmSync(p) } catch { /* absent */ } }
console.log(`\n▸ writing compacted DB → ${outPath}`)
const out = new Database(outPath)
out.exec('PRAGMA journal_mode=WAL')
out.exec(`CREATE TABLE atoms ( handle TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT, outgoing TEXT, tv_strength REAL, tv_conf REAL, av_sti REAL NOT NULL DEFAULT 0, av_lti REAL NOT NULL DEFAULT 0, av_vlti INTEGER NOT NULL DEFAULT 0, vals_json TEXT NOT NULL DEFAULT '{}', seq INTEGER NOT NULL, created_at TEXT NOT NULL )`)
// Copy kept rows via an attached read of the source, filtered by a temp keep-set table (150k IN-clause won't fly).
out.exec(`ATTACH DATABASE '${dbPath.replace(/'/g, "''")}' AS s`)
out.exec('CREATE TEMP TABLE keep (h TEXT PRIMARY KEY)')
const insKeep = out.prepare('INSERT OR IGNORE INTO keep (h) VALUES (?)')
out.transaction(() => { for (const r of rows) if (!exhaust.has(r.handle)) insKeep.run(r.handle) })()
out.exec('INSERT INTO atoms SELECT a.handle,a.type,a.name,a.outgoing,a.tv_strength,a.tv_conf,a.av_sti,a.av_lti,a.av_vlti,a.vals_json,a.seq,a.created_at FROM s.atoms a JOIN keep k ON a.handle = k.h ORDER BY a.seq')
const wrote = out.query('SELECT COUNT(*) n FROM atoms').get().n
out.exec('DROP TABLE keep'); out.exec('DETACH DATABASE s')
out.exec('PRAGMA wal_checkpoint(TRUNCATE)')
out.close()
console.log(`  ✓ wrote ${wrote.toLocaleString()} atoms (expected ${keepN.toLocaleString()})`)
if (wrote !== keepN) { console.error('  ✗ row-count mismatch — NOT swapping. Inspect .compacted manually.'); process.exit(1) }

if (!SWAP) { console.log(`\n▸ done. Compacted DB at ${outPath}. Re-run with --swap to back up + replace the live DB (STOP the app first).`); process.exit(0) }

// SWAP — back up the live DB, then move the compacted one in. Requires the app stopped (open handles corrupt).
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = `${dbPath}.backup-${stamp}`
console.log(`\n▸ backing up live DB → ${backup}`)
fs.copyFileSync(dbPath, backup)
for (const suf of ['-wal', '-shm']) { try { if (fs.existsSync(dbPath + suf)) fs.copyFileSync(dbPath + suf, backup + suf) } catch { /* */ } }
// Replace live with compacted; clear stale WAL/SHM of the live DB so it reopens clean.
fs.renameSync(outPath, dbPath)
for (const suf of ['-wal', '-shm']) { try { fs.rmSync(dbPath + suf) } catch { /* */ }; try { if (fs.existsSync(outPath + suf)) fs.renameSync(outPath + suf, dbPath + suf) } catch { /* */ } }
console.log(`  ✓ swapped. Live DB is now compacted (${wrote.toLocaleString()} atoms). Backup: ${backup}`)
console.log('  Restart Noetica to load the compacted graph.')
