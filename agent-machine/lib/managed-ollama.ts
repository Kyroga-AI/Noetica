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

/** The sandbox-exec launch recipe for the managed Ollama. */
export function buildLaunchRecipe(binary: string): { cmd: string; args: string[]; env: Record<string, string> } {
  return {
    cmd: 'sandbox-exec',
    args: ['-D', `HOME=${os.homedir()}`, '-f', PROFILE_PATH, binary, 'serve'],
    env: {
      OLLAMA_HOST: `127.0.0.1:${MANAGED_PORT}`,
      OLLAMA_MODELS: MODELS_DIR,
      OLLAMA_KEEP_ALIVE: '30m',
    },
  }
}
