#!/usr/bin/env node
/**
 * Post-build bundle smoke test — the gap CI had: a bundle can COMPILE but fail to RUN (orphaned sidecar pid,
 * missing dylib, stale socket, bad path resolution). This boots the agent-machine sidecar and confirms it
 * actually SERVES on its port using only no-model endpoints (no cloud keys needed), then tears it down.
 *
 * Usage:
 *   SMOKE_AM_BIN=/path/to/agent-machine-<triple>  node scripts/bundle-smoke.mjs   # test the compiled binary
 *   node scripts/bundle-smoke.mjs                                                  # dev fallback via tsx
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = process.env.SMOKE_PORT || '8099'
const BASE = `http://127.0.0.1:${PORT}`
const BIN = process.env.SMOKE_AM_BIN || ''
const BOOT_TIMEOUT_MS = Number(process.env.SMOKE_BOOT_MS || 90_000)

const [cmd, args, cwd] = BIN
  ? [BIN, [], ROOT]
  : ['node', ['--import', 'tsx', 'server.ts'], join(ROOT, 'agent-machine')]

console.log(`▸ booting agent-machine via: ${BIN || 'tsx server.ts (dev)'} on :${PORT}`)
const child = spawn(cmd, args, { cwd, env: { ...process.env, NOETICA_AM_PORT: PORT }, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
child.stdout.on('data', (d) => { logs += d })
child.stderr.on('data', (d) => { logs += d })

const die = (msg) => { console.error(`✗ bundle smoke FAILED: ${msg}`); try { child.kill('SIGKILL') } catch { /* */ }; console.error('--- last sidecar output ---\n' + logs.slice(-1200)); process.exit(1) }
const ok = (msg) => console.log(`  ✓ ${msg}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

child.on('exit', (code) => { if (code !== null && code !== 0) die(`sidecar exited early (code ${code})`) })

// Wait for the sidecar to answer /api/status.
const start = Date.now()
let up = false
while (Date.now() - start < BOOT_TIMEOUT_MS) {
  try { const r = await fetch(`${BASE}/api/status`, { signal: AbortSignal.timeout(2000) }); if (r.ok) { up = true; break } } catch { /* not up yet */ }
  await sleep(2000)
}
if (!up) die(`sidecar did not answer /api/status within ${BOOT_TIMEOUT_MS}ms`)
ok(`sidecar booted + /api/status 200 (${Math.round((Date.now() - start) / 1000)}s)`)

// No-model endpoints must serve (these prove routing + lib loading work without any cloud key).
for (const path of ['/api/flags', '/api/fleet', '/api/learning/stats']) {
  try {
    const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) die(`${path} → HTTP ${r.status}`)
    await r.json()
    ok(`${path} 200 + valid JSON`)
  } catch (e) { die(`${path} threw: ${e instanceof Error ? e.message : e}`) }
}

try { child.kill('SIGKILL') } catch { /* */ }
console.log('✓ bundle smoke passed — the sidecar boots and serves')
process.exit(0)
