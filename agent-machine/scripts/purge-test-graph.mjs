#!/usr/bin/env node
/**
 * purge-test-graph — remove corpus-test-* pollution from the live HellGraph JSONL.
 *
 * The graphbrain-bridge tests wrote `corpus-test-<timestamp>` Domain/Topic/GlossaryTerm atoms
 * into the real graph (~/.noetica/hellgraph), which surface as duplicate/orphan "corpus test"
 * nodes. The atomspace JSONL is append-only (no in-store delete), so the only true cleanup is
 * to rewrite the file without those lines. Every corpus-test atom AND every edge touching one
 * carries the `corpus-test` id string, so a line-level filter removes the whole subgraph.
 *
 * SAFE: writes a timestamped .bak first and reports before/after counts.
 * REQUIREMENT: quit the Noetica app first (its Agent Machine holds the file open + appends).
 *
 *   node agent-machine/scripts/purge-test-graph.mjs
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'

const JSONL = process.env.NOETICA_HELLGRAPH_JSONL || join(homedir(), '.noetica', 'hellgraph', 'sociosphere-primary.atomspace.jsonl')
const NEEDLE = /corpus-test/i

function amRunning() {
  return new Promise((resolve) => {
    const s = net.connect(8080, '127.0.0.1')
    s.setTimeout(800)
    s.on('connect', () => { s.destroy(); resolve(true) })
    s.on('error', () => resolve(false))
    s.on('timeout', () => { s.destroy(); resolve(false) })
  })
}

const run = async () => {
  if (await amRunning()) {
    console.error('⚠  The Agent Machine is running on :8080 — quit the Noetica app first, then re-run.')
    console.error('   (Purging while it holds the file open risks losing the cleanup or corrupting the log.)')
    process.exit(2)
  }
  // Read directly and handle absence — no exists-then-read race (TOCTOU).
  let raw
  try { raw = readFileSync(JSONL, 'utf8') }
  catch (e) { console.error(e.code === 'ENOENT' ? `No graph file at ${JSONL}` : String(e)); process.exit(1) }
  const lines = raw.split('\n')
  const kept = lines.filter((l) => l && !NEEDLE.test(l))
  const removed = lines.filter((l) => l).length - kept.length
  if (removed === 0) { console.log('Nothing to purge — no corpus-test lines found. ✓'); return }

  const bak = `${JSONL}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`
  copyFileSync(JSONL, bak)
  writeFileSync(JSONL, kept.join('\n') + '\n')
  console.log(`Purged ${removed} corpus-test lines.`)
  console.log(`  before: ${lines.filter((l) => l).length} lines`)
  console.log(`  after:  ${kept.length} lines`)
  console.log(`  backup: ${bak}`)
  console.log('Restart the Noetica app to load the cleaned graph.')
}
run().catch((e) => { console.error(e); process.exit(1) })
