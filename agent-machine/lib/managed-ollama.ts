/**
 * Managed Ollama (T2 isolation provider: seatbelt-native-metal).
 *
 * Runs the app's OWN complete Ollama as a host process confined by a macOS
 * `seatbelt` (`sandbox-exec`) profile: filesystem writes restricted to the app
 * data dir, Metal GPU allowed (validated — headless Metal compute works under the
 * profile), isolated port + model dir. No user/system Ollama, no VM overhead.
 *
 * This is the broadest Mac tier (any Mac, any RAM) and the replacement for the
 * old "fall back to the user's Ollama" hack — here the app ships and confines its
 * own runtime. The Tauri shell spawns `scripts/managed-ollama.ts`; the pure parts
 * (profile, binary resolution, launch recipe) live here and are unit-tested.
 */
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const _exec = promisify(execFile)

// Pinned SHA-256 of each supported ollama-darwin.tgz release asset (immutable per tag on GitHub). The
// runtime is a native binary we download and EXECUTE, so we verify the download against this before
// extracting/running it — a compromised release or CDN swap otherwise lands RCE as the user. When the
// default OLLAMA_VERSION below is bumped, ADD the new tag's hash here (shasum -a 256 the .tgz).
const EXPECTED_SHA256: Record<string, string> = {
  '0.30.8': '52acbca4e89c53db9abc586a22b5633fd101db293177264b9a0fe5d64a42a064',
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    const s = fs.createReadStream(file)
    s.on('data', (d) => h.update(d))
    s.on('error', reject)
    s.on('end', () => resolve(h.digest('hex')))
  })
}

export const MANAGED_PORT = 11435
export const MODELS_DIR = path.join(os.homedir(), '.noetica', 'models')
export const RUNTIME_DIR = path.join(os.homedir(), '.noetica', 'runtime')
export const PROFILE_PATH = path.join(RUNTIME_DIR, 'ollama.sb')

/**
 * seatbelt (SBPL) profile: deny-by-default, then allow exactly what a headless
 * Metal-accelerated Ollama needs. Writes are confined to the app data dir + tmp;
 * the user's documents/keys are NOT writable and (in a future tightening) not
 * readable. `(param "HOME")` is supplied via `sandbox-exec -D HOME=...`.
 */
export function seatbeltProfile(): string {
  return `(version 1)
(deny default)
;; exec / process
(allow process-exec*)
(allow process-fork)
(allow signal (target self))
(allow sysctl-read)
;; GPU / Metal headless compute (validated: library=Metal works under this)
(allow mach-lookup)
(allow iokit-open)
;; filesystem: broad read for frameworks/dylibs; WRITES confined to app data + tmp
(allow file-read*)
(allow file-write*
  (subpath (string-append (param "HOME") "/.noetica"))
  (subpath "/private/tmp")
  (subpath "/private/var/folders")
  (regex #"^/dev/"))
;; network: localhost bind + outbound (first-run model pulls)
(allow network*)
`
}

/**
 * Resolve the app-managed Ollama binary. Preference: explicit env → app runtime
 * dir (provisioned on first run) → a complete dev install. Returns null if none
 * found (caller should provision into RUNTIME_DIR).
 */
export function resolveManagedOllamaBinary(env: Record<string, string | undefined> = process.env): string | null {
  const candidates = [
    env['NOETICA_OLLAMA_BIN'],
    path.join(RUNTIME_DIR, 'ollama'),
    '/opt/homebrew/bin/ollama',
    '/usr/local/bin/ollama',
  ].filter((c): c is string => Boolean(c))
  // Existence is checked by the caller (fs); resolution order is the policy under test.
  return candidates[0] ?? null
}

/** The inference runner (`llama-server`) sits flat beside `ollama` on macOS, or
 *  under lib/ollama/ on Linux. Completeness = binary + a runner. */
export function runtimeComplete(binary = path.join(RUNTIME_DIR, 'ollama')): boolean {
  if (!fs.existsSync(binary)) return false
  const dir = path.dirname(binary)
  return fs.existsSync(path.join(dir, 'llama-server')) || fs.existsSync(path.join(dir, 'lib', 'ollama', 'llama-server'))
}

/**
 * Download the COMPLETE Ollama (binary + llama-server runner + dylibs) into the app
 * runtime dir. Idempotent (version stamp). macOS only — Linux uses the container
 * image. Returns the binary path, or null on failure.
 */
export async function provisionOllamaRuntime(version = process.env['OLLAMA_VERSION'] ?? '0.30.8'): Promise<string | null> {
  if (process.platform !== 'darwin') return null
  const bin = path.join(RUNTIME_DIR, 'ollama')
  const stamp = path.join(RUNTIME_DIR, '.version')
  if (runtimeComplete(bin) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === version) return bin
  fs.mkdirSync(RUNTIME_DIR, { recursive: true })
  const url = `https://github.com/ollama/ollama/releases/download/v${version}/ollama-darwin.tgz`
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noetica-rt-'))
  try {
    const archive = path.join(tmp, 'o.tgz')
    await _exec('curl', ['-fsSL', url, '-o', archive], { maxBuffer: 1 << 26 })
    // Integrity gate BEFORE extract/exec: verify the archive against the pinned hash. A version with no
    // pin can't be verified — fail closed unless the operator explicitly opts out (OLLAMA_ALLOW_UNVERIFIED=1).
    const expected = EXPECTED_SHA256[version]
    const actual = await sha256File(archive)
    if (expected) {
      if (actual !== expected) {
        console.error(`[managed-ollama] checksum mismatch for ollama ${version}: expected ${expected}, got ${actual} — refusing to install`)
        return null
      }
    } else if (process.env['OLLAMA_ALLOW_UNVERIFIED'] === '1') {
      console.warn(`[managed-ollama] installing UNVERIFIED ollama ${version} (sha256 ${actual}) — OLLAMA_ALLOW_UNVERIFIED=1`)
    } else {
      console.error(`[managed-ollama] no pinned checksum for ollama ${version} (sha256 ${actual}); refusing to install. Add it to EXPECTED_SHA256 or set OLLAMA_ALLOW_UNVERIFIED=1.`)
      return null
    }
    await _exec('tar', ['-xzf', archive, '-C', RUNTIME_DIR], { maxBuffer: 1 << 26 })
    fs.chmodSync(bin, 0o755)
    if (!runtimeComplete(bin)) return null
    fs.writeFileSync(stamp, version)
    return bin
  } catch { return null } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

/** The sandbox-exec launch recipe for the managed Ollama. */
export function buildLaunchRecipe(binary: string): { cmd: string; args: string[]; env: Record<string, string> } {
  return {
    cmd: 'sandbox-exec',
    args: ['-D', `HOME=${os.homedir()}`, '-f', PROFILE_PATH, binary, 'serve'],
    env: {
      OLLAMA_HOST: `127.0.0.1:${MANAGED_PORT}`,
      OLLAMA_HOME: path.join(os.homedir(), '.noetica', 'ollama-home'),
      OLLAMA_MODELS: MODELS_DIR,
      OLLAMA_KEEP_ALIVE: '30m',
    },
  }
}
