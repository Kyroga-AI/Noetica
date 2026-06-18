/**
 * Boot-time managed runtime (macOS T2).
 *
 * Makes the agent-machine OWN its model plane so the shipped app works end-to-end
 * with no host Ollama and no reliance on the (possibly incomplete) bundled sidecar:
 * on boot it ensures a COMPLETE Ollama runtime exists (provisions it if missing),
 * frees the isolated port, and launches that runtime under the seatbelt sandbox.
 * Since the managed port IS the agent-machine's default OLLAMA primary, no repoint
 * is needed — the existing client just works.
 *
 * Disable with NOETICA_MANAGED_RUNTIME=0 (e.g. when OLLAMA_HOST points elsewhere).
 */
import * as fs from 'node:fs'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { seatbeltProfile, resolveManagedOllamaBinary, buildLaunchRecipe, provisionOllamaRuntime, runtimeComplete, PROFILE_PATH, RUNTIME_DIR, MODELS_DIR, MANAGED_PORT } from './managed-ollama.js'

const exec = promisify(execFile)

async function freePort(port: number): Promise<void> {
  try {
    const { stdout } = await exec('/usr/sbin/lsof', ['-ti', `TCP:${port}`, '-sTCP:LISTEN'])
    const pids = stdout.trim().split('\n').filter(Boolean)
    for (const pid of pids) { try { process.kill(Number(pid), 'SIGKILL') } catch { /* gone */ } }
    if (pids.length) await new Promise((r) => setTimeout(r, 800))
  } catch { /* nothing listening */ }
}

async function provisionIfNeeded(): Promise<string | null> {
  const existing = resolveManagedOllamaBinary()
  if (existing && runtimeComplete(existing)) return existing
  return provisionOllamaRuntime()  // download the complete runtime into ~/.noetica/runtime
}

export interface ManagedRuntime { child: ChildProcess; port: number; base: string }

/**
 * Ensure a complete, sandboxed Ollama is serving on the managed port. Returns the
 * handle, or null if it couldn't be established (caller logs and continues — chat
 * will surface a clear error rather than silently using a host install).
 */
export async function ensureManagedRuntime(port = MANAGED_PORT): Promise<ManagedRuntime | null> {
  if (process.platform !== 'darwin') return null
  const binary = await provisionIfNeeded()
  if (!binary) { console.warn('[managed-runtime] no complete Ollama runtime available — skipping'); return null }

  fs.mkdirSync(RUNTIME_DIR, { recursive: true })
  fs.mkdirSync(MODELS_DIR, { recursive: true })
  fs.writeFileSync(PROFILE_PATH, seatbeltProfile())
  await freePort(port)   // evict any incumbent (e.g. an incomplete bundled Ollama)

  const { cmd, args, env } = buildLaunchRecipe(binary)
  const child = spawn(cmd, args, { env: { ...process.env, ...env, OLLAMA_HOST: `127.0.0.1:${port}` }, stdio: 'ignore', detached: false })
  child.on('exit', (code) => console.log(`[managed-runtime] sandboxed Ollama exited: ${code}`))

  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 60_000  // generous: cold launch under RAM pressure can be slow
  while (Date.now() < deadline) {
    try { const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) }); if (r.ok) {
      console.log(`[managed-runtime] sandboxed Ollama (Metal) serving on ${base} — app-owned, no host dependency`)
      return { child, port, base }
    } } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.warn('[managed-runtime] sandboxed Ollama did not become ready in 30s')
  return { child, port, base }
}
