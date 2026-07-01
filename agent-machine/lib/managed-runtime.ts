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
import * as os from 'node:os'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { seatbeltProfile, resolveManagedOllamaBinary, buildLaunchRecipe, provisionOllamaRuntime, runtimeComplete, PROFILE_PATH, RUNTIME_DIR, MODELS_DIR, MANAGED_PORT } from './managed-ollama.js'
import { setOllamaBase, provisionCpuVariants } from './ollama.js'

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

// ── In-session orphan-runner reaper ──────────────────────────────────────────
// Ollama spawns a llama-server runner per model load. When concurrent cold-load
// requests race during boot (the CPU-variant provisioning + the chat/status
// preflight + a turn's embed-then-generate all fire at once) it can spawn
// DUPLICATE runners for the same model and lose track of the extras. Those
// orphans then linger for the whole session holding RAM (measured: 9 leaked
// runners, memory down to ~30% free, until the next app launch reaps them at
// line ~104). The boot-time pkill only helps ACROSS launches; this reaps
// WITHIN a session so the leak can't accumulate.

/** How a managed llama-server runner looks to the reaper. */
export interface RunnerProc { pid: number; rssKb: number; ageSec: number }

/**
 * Choose which managed runners are orphans safe to reap. A runner is reapable when
 * it holds NO resident model (rss below a loaded-model floor — even the 0.3GB
 * embedder is hundreds of MB resident, an emptied runner is <30MB) AND it has been
 * alive past the cold-load mmap window (so a runner mid-load is never killed). As a
 * hard floor we never reap more than the surplus over `loadedCount` (what /api/ps
 * reports loaded), so a paged-out-but-live model is protected. Pure + unit-tested.
 */
export function selectOrphanRunners(
  runners: RunnerProc[],
  loadedCount: number,
  opts: { residentFloorKb?: number; settleSec?: number } = {},
): number[] {
  const residentFloorKb = opts.residentFloorKb ?? 200 * 1024   // <200MB resident ⇒ no model loaded
  const settleSec = opts.settleSec ?? 90                        // past any cold-load mmap window
  const surplus = Math.max(0, runners.length - Math.max(0, loadedCount))
  if (surplus === 0) return []
  return runners
    .filter((r) => r.rssKb < residentFloorKb && r.ageSec > settleSec)
    .sort((a, b) => b.ageSec - a.ageSec)   // oldest (most likely abandoned) first
    .slice(0, surplus)
    .map((r) => r.pid)
}

/** Snapshot the managed Ollama's direct llama-server runner children. */
async function listManagedRunners(parentPid: number): Promise<RunnerProc[]> {
  try {
    const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid=,etimes=,rss=,command='])
    const out: RunnerProc[] = []
    for (const line of stdout.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)
      if (!m) continue
      if (Number(m[2]) !== parentPid || !m[5]!.includes('llama-server')) continue
      out.push({ pid: Number(m[1]), rssKb: Number(m[4]), ageSec: Number(m[3]) })
    }
    return out
  } catch { return [] }
}

/** How many models the managed Ollama currently has loaded (0 on any failure). */
async function loadedModelCount(base: string): Promise<number> {
  try {
    const r = await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(2000) })
    if (!r.ok) return 0
    const j = (await r.json()) as { models?: unknown[] }
    return Array.isArray(j.models) ? j.models.length : 0
  } catch { return 0 }
}

/** Reconcile runners against loaded models and SIGTERM the orphaned surplus. Best-effort. */
export async function reapOrphanRunners(base: string, parentPid: number): Promise<number[]> {
  const runners = await listManagedRunners(parentPid)
  if (runners.length === 0) return []
  const orphans = selectOrphanRunners(runners, await loadedModelCount(base))
  for (const pid of orphans) { try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ } }
  if (orphans.length) console.log(`[managed-runtime] reaped ${orphans.length} orphaned llama-server runner(s) (total=${runners.length})`)
  return orphans
}

const REAP_INTERVAL_MS = 3 * 60_000   // sweep every 3 min — well inside the 5m keep_alive window

let _activeChild: ChildProcess | null = null
let _reapTimer: ReturnType<typeof setInterval> | null = null
let _lastRestart = 0

/**
 * Restart the managed Ollama when its runner has WEDGED — the classic failure mode on macOS: it still answers
 * /api/tags (so it looks "running") but the Metal runner is dead, so every generate hangs/returns empty. Heavy
 * bulk ingestion (many embeds + a big graph) can push it there. Without this, the app shows "warming up" forever
 * and resending never helps. Debounced so a burst of failures triggers exactly one restart.
 */
export async function restartManagedRuntime(): Promise<boolean> {
  if (process.platform !== 'darwin' || !shouldManageRuntime(process.env)) return false
  if (Date.now() - _lastRestart < 30_000) return false   // one restart per 30s — don't thrash
  _lastRestart = Date.now()
  console.warn('[managed-runtime] Ollama wedged (lists models, cannot generate) — restarting the runtime')
  if (_reapTimer) { clearInterval(_reapTimer); _reapTimer = null }   // stop sweeping a runtime we're tearing down
  try { _activeChild?.kill('SIGKILL') } catch { /* already gone */ }
  _activeChild = null
  try { await exec('/usr/bin/pkill', ['-9', '-f', `${process.env['HOME'] ?? ''}/.noetica/runtime/llama-server`]) } catch { /* none */ }
  const rt = await ensureManagedRuntime()   // re-provisions (fast if cached) + reaps stale + respawns + waits ready
  return rt !== null
}

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
  // Reap any stale managed Ollama from a previous run (a crash or hard-kill that skipped
  // graceful teardown) before picking a port — otherwise leaked instances pile up across
  // :11435, :11436, … and each launch spawns yet another. This range is app-owned; the
  // user's own Ollama lives on :11434 and is never touched.
  for (const p of [preferredPort, preferredPort + 1, preferredPort + 2]) await freePort(p)
  // …and reap orphaned llama-server runners from prior managed instances — they survive a
  // hard kill of `ollama serve` and otherwise pile up holding GPU/RAM across launches.
  try { await exec('/usr/bin/pkill', ['-9', '-f', `${process.env['HOME'] ?? ''}/.noetica/runtime/llama-server`]) } catch { /* none running */ }
  const port = await pickPort(preferredPort)   // a free port — no fight with a bundled Ollama
  const base = `http://127.0.0.1:${port}`
  // PIN the base NOW (before the runtime is even ready) so the chat preflight targets
  // the app-owned runtime from the first request — never the bundled Ollama on the
  // primary port (which lists models but can't generate). Chats during startup see
  // "not ready yet" on the managed port instead of a runner-missing error.
  setOllamaBase(base)

  const { cmd, args, env } = buildLaunchRecipe(binary)
  // Keep the resident model count bounded by RAM. Stacking models exhausts the
  // unified memory the GPU shares and pushes the runner into the Metal OOM that
  // yields empty responses — or kills the whole app (a 14b coder is ~9GB; loading
  // it alongside the 7b general + embedder on a 24GB box overcommits and crashes).
  // So we cap *resident* models — ollama unloads-before-loading — on anything
  // short of a workstation-class box, not just the tiny ones.
  // MAX_LOADED must be ≥2 wherever embeds run through Ollama (nomic-embed): a turn embeds the query THEN
  // generates, so with only ONE slot the embed model evicts the chat model and generation reloads a multi-GB
  // model EVERY turn (measured: only qwen3:8b resident after a turn, nomic gone — it had evicted+been evicted).
  // 2 slots let the tiny 0.3GB embedder and one chat model coexist → the chat model stays warm. NUM_PARALLEL=1
  // keeps the KV-cache footprint down so two models stay within 24GB (single-user desktop doesn't need parallel).
  // The proper long-term fix is routing query-embeds to the Rust noetica-embed sidecar (no Ollama slot at all).
  const totalGb = os.totalmem() / 1e9
  const memEnv = totalGb < 16
    ? { OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_NUM_PARALLEL: '1', OLLAMA_KEEP_ALIVE: '5m' }
    : totalGb < 32
    ? { OLLAMA_MAX_LOADED_MODELS: '2', OLLAMA_NUM_PARALLEL: '1', OLLAMA_KEEP_ALIVE: '5m' }
    : { OLLAMA_MAX_LOADED_MODELS: '3', OLLAMA_NUM_PARALLEL: '2', OLLAMA_KEEP_ALIVE: '10m' }
  const child = spawn(cmd, args, { env: { ...process.env, ...env, ...memEnv, OLLAMA_HOST: `127.0.0.1:${port}` }, stdio: 'ignore', detached: false })
  _activeChild = child   // held so restartManagedRuntime() can kill a wedged runner
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
      // Sweep leaked runners for the life of this instance (the boot-time race that
      // spawns duplicate runners keeps recurring on reconnect/warmup, not just at boot).
      if (_reapTimer) clearInterval(_reapTimer)
      if (child.pid) {
        const parentPid = child.pid
        _reapTimer = setInterval(() => { void reapOrphanRunners(base, parentPid) }, REAP_INTERVAL_MS)
        _reapTimer.unref?.()   // never keep the process alive just for the sweep
      }
      return { child, port, base }
    } } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.warn('[managed-runtime] sandboxed Ollama did not become ready in 60s')
  return { child, port, base }
}
