#!/usr/bin/env node
/**
 * check-sidecar-parity — guard against the "silent 404 in the packaged desktop app" class of bug.
 *
 * In the packaged Tauri build, the fetch shim routes ALL /api/* calls to the agent-machine sidecar (:8080);
 * Next.js app/api routes do NOT ship. So any /api path the desktop UI calls that the sidecar doesn't handle
 * 404s silently in production (even if a Next route exists for the browser). This script diffs the frontend's
 * /api/* call sites against the sidecar's handlers and fails on NEW unmatched paths.
 *
 * Known web-only / external / dynamic paths are allowlisted below (audited 2026-06-27). Add a path here ONLY
 * after confirming it's genuinely not needed in the desktop build (or, better, add the sidecar handler).
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

// External (not our sidecar) or web-only-by-design — confirmed in the 2026-06-27 audit. Prefer adding a sidecar
// handler over extending this list.
const ALLOW = new Set([
  '/api/embeddings',      // Ollama's own API (${OLLAMA_BASE}/api/embeddings), not ours
  '/api/v1',              // external git-server proxy paths (/api/v1/repos/*, /api/v1/version)
  '/api/oauth',           // OAuth token exchange — connector-config flow
  '/api/openid',          // auth
  // Web-only client-side tool fallback (superseded by the server-side tool loop in desktop) + dev surfaces.
  // TODO: either add sidecar handlers or remove these call sites; tracked from the audit.
  '/api/agent-tool', '/api/search', '/api/generate-image', '/api/execute', '/api/steer',
  '/api/sae', '/api/features', '/api/core', '/api/event', '/api/getting-started', '/api/embed',
])

const grep = (pattern, dirs) => {
  try { return execSync(`grep -rhoE "${pattern}" ${dirs} 2>/dev/null`, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean) }
  catch { return [] }
}

const fe = [...new Set(grep('/api/[a-zA-Z0-9/_-]+', 'components lib app'))].sort()
const be = [...new Set(grep("'/api/[a-zA-Z0-9/_-]+'", 'agent-machine/server.ts').map((s) => s.replace(/'/g, '').replace(/\/$/, '')))]

const covered = (p) => be.some((b) => p === b || p.startsWith(b + '/'))
const allowed = (p) => [...ALLOW].some((a) => p === a || p.startsWith(a + '/'))

const missing = fe.filter((p) => !covered(p) && !allowed(p))

if (missing.length) {
  console.error(`✗ sidecar-parity: ${missing.length} frontend /api path(s) have no sidecar handler and aren't allowlisted:`)
  for (const m of missing) console.error('  ' + m)
  console.error('\nAdd a handler in agent-machine/server.ts, or allowlist in scripts/check-sidecar-parity.mjs after confirming it is not needed in the packaged desktop build.')
  process.exit(1)
}
console.log(`✓ sidecar-parity: all ${fe.length} frontend /api paths are handled or allowlisted.`)
