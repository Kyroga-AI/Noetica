/**
 * Injects the agent-machine externalBin into tauri.conf.json for production builds.
 * Run before `tauri build` after `agent-machine:build:binary` has placed binaries
 * in src-tauri/binaries/.
 *
 * Usage: node scripts/inject-am-sidecar-config.mjs [--restore]
 *   --restore  Remove externalBin (undo for dev builds)
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const configPath = join(__dir, '../src-tauri/tauri.conf.json')

const config = JSON.parse(readFileSync(configPath, 'utf-8'))
const restore = process.argv.includes('--restore')

if (restore) {
  delete config.bundle?.externalBin
  console.log('Removed externalBin from tauri.conf.json (dev mode restored)')
} else {
  config.bundle = config.bundle ?? {}
  config.bundle.externalBin = ['binaries/agent-machine', 'binaries/ollama', 'binaries/noetica-embed', 'binaries/noetica-operator']
  console.log('Injected externalBin: ["binaries/agent-machine", "binaries/ollama", "binaries/noetica-embed", "binaries/noetica-operator"] into tauri.conf.json')
}

writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
