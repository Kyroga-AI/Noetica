/**
 * Injects the agent-machine externalBin into tauri.conf.json for production builds.
 * Run before `tauri build` after `agent-machine:build:binary` has placed binaries
 * in src-tauri/binaries/.
 *
 * Usage: node scripts/inject-am-sidecar-config.mjs [--restore]
 *   --restore  Remove externalBin (undo for dev builds)
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const configPath = join(__dir, '../src-tauri/tauri.conf.json')
const binariesDir = join(__dir, '../src-tauri/binaries')

const config = JSON.parse(readFileSync(configPath, 'utf-8'))
const restore = process.argv.includes('--restore')

// Tauri resolves an externalBin entry `binaries/<name>` to a file `binaries/<name>-<target-triple>`.
// If a listed binary is missing, `tauri build` aborts with "resource path ... doesn't exist" — and
// because deploy.sh's `[ -d "$APP_BUILT" ]` check passes on a STALE prior bundle, that abort ships an
// old frontend silently. So only inject binaries that actually exist on disk, and warn about any we drop.
function existsOnDisk(name) {
  const prefix = `${name}-`
  try { return readdirSync(binariesDir).some((f) => f.startsWith(prefix)) }
  catch { return false }
}

if (restore) {
  delete config.bundle?.externalBin
  console.log('Removed externalBin from tauri.conf.json (dev mode restored)')
} else {
  config.bundle = config.bundle ?? {}
  const candidates = ['agent-machine', 'ollama', 'noetica-embed', 'noetica-operator']
  const present = candidates.filter(existsOnDisk)
  const missing = candidates.filter((n) => !present.includes(n))
  if (missing.length) console.warn(`⚠ skipping externalBin (binary not built): ${missing.join(', ')}`)
  config.bundle.externalBin = present.map((n) => `binaries/${n}`)
  console.log(`Injected externalBin: ${JSON.stringify(config.bundle.externalBin)} into tauri.conf.json`)
}

writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
