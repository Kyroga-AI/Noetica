/**
 * T2 provider entrypoint: launch the app's own Ollama under a seatbelt sandbox.
 * The Tauri shell spawns this (or replicates it in Rust). Foreground — it owns
 * the sandboxed Ollama process lifecycle.
 *
 *   tsx scripts/managed-ollama.ts
 */
import * as fs from 'node:fs'
import { spawn } from 'node:child_process'
import { seatbeltProfile, resolveManagedOllamaBinary, buildLaunchRecipe, PROFILE_PATH, RUNTIME_DIR, MODELS_DIR, MANAGED_PORT } from '../lib/managed-ollama.js'

if (process.platform !== 'darwin') {
  console.error('[managed-ollama] seatbelt provider is macOS-only; use the container/VM provider elsewhere')
  process.exit(1)
}

fs.mkdirSync(RUNTIME_DIR, { recursive: true })
fs.mkdirSync(MODELS_DIR, { recursive: true })
fs.writeFileSync(PROFILE_PATH, seatbeltProfile())

const binary = resolveManagedOllamaBinary()
if (!binary || !fs.existsSync(binary)) {
  console.error(`[managed-ollama] no complete Ollama binary found (looked for NOETICA_OLLAMA_BIN, ${RUNTIME_DIR}/ollama, /opt/homebrew/bin/ollama). Provision one into ${RUNTIME_DIR}/ (PM3).`)
  process.exit(1)
}

const { cmd, args, env } = buildLaunchRecipe(binary)
console.log(`[managed-ollama] launching ${binary} under seatbelt on :${MANAGED_PORT} (models: ${MODELS_DIR})`)
const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: 'inherit' })
child.on('exit', (code) => { console.log(`[managed-ollama] exited: ${code}`); process.exit(code ?? 0) })
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => child.kill(sig))
