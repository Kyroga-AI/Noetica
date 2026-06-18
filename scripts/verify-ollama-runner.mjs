#!/usr/bin/env node
/**
 * Bundle-integrity guard: assert the Ollama sidecar set is COMPLETE before Tauri
 * bundles it. Ollama 0.30+ needs its `lib/ollama` runner (the llama-server
 * backend) alongside the `ollama` binary — shipping the binary alone yields a
 * server that lists models but 500s on every generation (the freeze that killed
 * a live demo). This runs after scripts/download-sidecars.sh in CI.
 *
 * Exit 1 if the ollama binary or its runner dir is missing from src-tauri/binaries.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const binDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'binaries')
const problems = []

if (!existsSync(binDir)) {
  problems.push(`binaries dir missing: ${binDir}`)
} else {
  const entries = readdirSync(binDir)
  if (!entries.some((e) => e.startsWith('ollama-'))) problems.push('no ollama-<triple> binary staged')

  // The inference runner is `llama-server` + dylibs. macOS extracts these FLAT
  // alongside `ollama`; Linux puts them under lib/ollama/. (Preferred path is now
  // first-run provisioning into ~/.noetica/runtime — this guard only matters if the
  // runtime is bundled in the app instead.)
  const flat = existsSync(join(binDir, 'llama-server'))
  const nested = existsSync(join(binDir, 'lib', 'ollama', 'llama-server'))
  if (!flat && !nested) {
    problems.push('llama-server runner missing (flat or lib/ollama/) — bundled Ollama could not run inference')
  } else {
    console.log(`  runner present (${flat ? 'flat macOS layout' : 'lib/ollama'})`)
  }
}

if (problems.length > 0) {
  console.error('✗ Ollama sidecar bundle incomplete:')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('  The bundled Ollama would freeze on generation. Fix download-sidecars staging.')
  process.exit(1)
}
console.log('✓ Ollama sidecar complete (binary + lib/ollama runner) — bundle will run inference')
