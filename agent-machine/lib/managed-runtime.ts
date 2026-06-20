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
import { setOllamaBase, isLowMemoryHost, provisionCpuVariants } from './ollama.js'

const exec = promisify(execFile)

async function portInUse(port: number): Promise<boolean> {
  try { const { stdout } = await exec('/usr/sbin/lsof', ['-ti', `TCP:${port}`, '-sTCP:LISTEN']); return stdout.trim().length > 0 } catch { return false }
}

/** Kill whatever is listening on a port (used to reclaim the bundled Ollama's RAM
 *  once the managed runtime is authoritative). Best-effort. */
async function freePort(port: number): Promise<void> {
  try {
    const { stdout } = await exec('/usr/sbin/lsof', ['-ti', `TCP:${port}`, '-sTCP:LISTEN'])
    for (const pid of stdout.trim().split('\n').filter(Boolean)) { try { process.kill(Number(pid), 'SIGKILL') } catch { /* gone */ } }
  } catch { /* nothing listening */ }
}

/** Pick a free port near the isolated one — avoids fighting a Rust-spawned bundled
 *  Ollama on the default port (and the startup race that would cause). */
async function pickPort(preferred: number): Promise<number> {
  for (const p of [preferred, preferred + 1, preferred + 2]) { if (!(await portInUse(p))) return p }
  return preferred
}

async function provisionIfNeeded(): Promise<string | null> {
  const existing = resolveManagedOllamaBinary()
  if (existing && runtimeComplete(existing)) return existing
  return provisionOllamaRuntime()  // download the complete runtime into ~/.noetica/runtime
}

/**
 * Should the agent-machine stand up its own managed runtime on boot? Yes on macOS
 * when targeting the isolated port and not explicitly disabled. Skips when a dev
 * OLLAMA_HOST points elsewhere (e.g. dev:backend → :11434) or NOETICA_MANAGED_RUNTIME=0.
 * Pure + unit-tested so the boot decision can't silently regress.
 */
export function shouldManageRuntime(env: Record<string, string | undefined>, platform: string = process.platform): boolean {
  if (platform !== 'darwin') return false
  if (env['NOETICA_MANAGED_RUNTIME'] === '0') return false
  const host = env['OLLAMA_HOST']
  return !host || host.includes(':11435')
}

export interface ManagedRuntime { child: ChildProcess; port: number; base: string }

/**
 * Ensure a complete, sandboxed Ollama is serving on the managed port. Returns the
 * handle, or null if it couldn't be established (caller logs and continues — chat
 * will surface a clear error rather than silently using a host install).
 */
export async function ensureManagedRuntime(preferredPort = MANAGED_PORT): Promise<ManagedRuntime | null> {
  if (process.platform !== 'darwin') return null
  const binary = await provisionIfNeeded()
  if (!binary) { console.warn('[managed-runtime] no complete Ollama runtime available — skipping'); return null }

  fs.mkdirSync(RUNTIME_DIR, { recursive: true })
  fs.mkdirSync(MODELS_DIR, { recursive: true })
  fs.writeFileSync(PROFILE_PATH, seatbeltProfile())
  const port = await pickPort(preferredPort)   // a free port — no fight with a bundled Ollama
  const base = `http://127.0.0.1:${port}`
  // PIN the base NOW (before the runtime is even ready) so the chat preflight targets
  // the app-owned runtime from the first request — never the bundled Ollama on the
  // primary port (which lists models but can't generate). Chats during startup see
  // "not ready yet" on the managed port instead of a runner-missing error.
  setOllamaBase(base)

  const { cmd, args, env } = buildLaunchRecipe(binary)
  // On small Apple Silicon boxes, keep only one model resident and unload it
  // promptly — stacking models exhausts the unified memory the GPU shares and
  // pushes the runner into the Metal OOM that yields empty responses.
  const memEnv = isLowMemoryHost()
    ? { OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_NUM_PARALLEL: '1', OLLAMA_KEEP_ALIVE: '5m' }
    : {}
  const child = spawn(cmd, args, { env: { ...process.env, ...env, ...memEnv, OLLAMA_HOST: `127.0.0.1:${port}` }, stdio: 'ignore', detached: false })
  child.on('exit', (code) => console.log(`[managed-runtime] sandboxed Ollama exited: ${code}`))

  const deadline = Date.now() + 60_000  // generous: cold launch under RAM pressure can be slow
  while (Date.now() < deadline) {
    try { const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) }); if (r.ok) {
      console.log(`[managed-runtime] sandboxed Ollama (Metal) serving on ${base} — app-owned, no host dependency`)
      // Reclaim RAM: the bundled Ollama on the primary port is now unused (we're pinned here).
      if (preferredPort !== port) await freePort(preferredPort)
      // Low-memory hosts: pre-provision CPU-pinned variants so the chat path never
      // needs a request-time create and never falls back to the GPU base model.
      void provisionCpuVariants(['llama3.2:3b', 'qwen2.5:7b', 'qwen2.5-coder:7b', 'deepseek-r1:8b'])
        .then(() => console.log('[managed-runtime] CPU-pinned variants provisioned'))
        .catch(() => {})
      return { child, port, base }
    } } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.warn('[managed-runtime] sandboxed Ollama did not become ready in 60s')
  return { child, port, base }
}
