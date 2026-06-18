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

  const runnerDir = join(binDir, 'lib', 'ollama')
  if (!existsSync(runnerDir)) {
    problems.push('lib/ollama runner dir missing — bundled Ollama would be unable to run inference')
  } else {
    const runners = readdirSync(runnerDir)
    if (runners.length === 0) problems.push('lib/ollama is empty — no inference runner')
    else {
      const total = runners.reduce((n, f) => { try { return n + statSync(join(runnerDir, f)).size } catch { return n } }, 0)
      console.log(`  lib/ollama: ${runners.length} entries, ${(total / 1e6).toFixed(1)} MB`)
    }
  }
}

if (problems.length > 0) {
  console.error('✗ Ollama sidecar bundle incomplete:')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('  The bundled Ollama would freeze on generation. Fix download-sidecars staging.')
  process.exit(1)
}
console.log('✓ Ollama sidecar complete (binary + lib/ollama runner) — bundle will run inference')
