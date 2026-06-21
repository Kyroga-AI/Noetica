/**
 * bearbrowser ↔ noetica security-state poller (drop-in).
 *
 * The noetica agent-machine writes a security signal whenever the security lane
 * is armed/disarmed and exposes it two ways:
 *   • file:  ~/.config/sourceos/noetica/security-state.json   → { armed, tor }
 *   • http:  GET http://127.0.0.1:<port>/api/security/state    → { armed, tor }
 *
 * This poller watches that state and toggles Tor in bearbrowser. Wire `setTor()`
 * to bearbrowser's actual proxy mechanism (the one place that knows your stack),
 * then call `startSecurityStatePoller()` once at startup.
 *
 * Copy this file into the sourceos-linux/bearbrowser repo (I couldn't access it
 * from the noetica session). Pick ONE source — HTTP is simplest if the agent
 * machine is running; the file watch works even when it isn't.
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const STATE_FILE = path.join(os.homedir(), '.config', 'sourceos', 'noetica', 'security-state.json')
const HTTP_URL = process.env.NOETICA_AGENT_MACHINE
  ? `${process.env.NOETICA_AGENT_MACHINE.replace(/\/$/, '')}/api/security/state`
  : 'http://127.0.0.1:3737/api/security/state'

// ── Wire this to bearbrowser's proxy mechanism ──────────────────────────────
// Tor's default SOCKS5 proxy is 127.0.0.1:9050. Replace the body with however
// bearbrowser sets/clears its proxy (Electron session.setProxy, CDP, config, …).
async function setTor(enabled) {
  if (enabled) {
    // e.g. await session.setProxy({ proxyRules: 'socks5://127.0.0.1:9050' })
    console.log('[bearbrowser] Tor ENABLED (armed) — route via socks5://127.0.0.1:9050')
  } else {
    // e.g. await session.setProxy({ mode: 'direct' })
    console.log('[bearbrowser] Tor DISABLED (disarmed) — direct')
  }
}

function readState() {
  // Prefer the file (works offline); fall back to HTTP.
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { /* fall through */ }
  return null
}

async function readStateHttp() {
  try {
    const res = await fetch(HTTP_URL, { signal: AbortSignal.timeout(2000) })
    if (res.ok) return await res.json()
  } catch { /* agent machine not up */ }
  return null
}

let lastTor = null
async function tick() {
  const state = readState() ?? (await readStateHttp())
  const tor = state?.tor === true
  if (tor !== lastTor) {
    lastTor = tor
    try { await setTor(tor) } catch (e) { console.error('[bearbrowser] setTor failed:', e) }
  }
}

function startSecurityStatePoller({ intervalMs = 3000 } = {}) {
  // React immediately to file changes, and poll as a heartbeat / HTTP fallback.
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    fs.watch(path.dirname(STATE_FILE), (_evt, name) => { if (name === 'security-state.json') void tick() })
  } catch { /* watch optional */ }
  void tick()
  return setInterval(tick, intervalMs)
}

module.exports = { startSecurityStatePoller, setTor }
