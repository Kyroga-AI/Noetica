/**
 * origin-guard — drive-by CSRF / DNS-rebinding defense for the loopback server.
 *
 * The server binds to 127.0.0.1, but `Access-Control-Allow-Origin: *` plus *simple* (no-preflight)
 * POSTs mean ANY web page the user visits can POST to it and trigger side effects — including
 * `run_command` (RCE) or arbitrary-file-read ingest. CORS does NOT stop this: it only blocks the
 * attacker's JS from READING the response; the WRITE/side-effect still fires. The correct defense is
 * server-side rejection of mutating requests that carry a cross-site Origin.
 *
 * Browsers attach an `Origin` header to every cross-origin POST. Native/CLI callers send none. The
 * local UI (a Tauri webview or a localhost dev server, any port) is loopback. So: allow absent Origin,
 * allow loopback / desktop-shell origins, reject everything else.
 */

/** True if this Origin is the local app (loopback host on any port, or a desktop-shell scheme). */
export function isLoopbackOrigin(origin: string): boolean {
  if (/^(tauri|app|file|capacitor|noetica):/i.test(origin)) return true
  try {
    const h = new URL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase()
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0' || h.endsWith('.localhost')
  } catch {
    return false // unparseable Origin → not loopback → rejected
  }
}

/**
 * Decide whether a request may proceed. `method` is the HTTP verb, `origin` the raw Origin header
 * (or undefined when absent). Read-only verbs and absent/loopback origins pass; a cross-site Origin
 * on a mutating verb is rejected. Pure + side-effect-free so it's unit-testable.
 */
export function originAllowed(method: string | undefined, origin: string | undefined): boolean {
  const m = (method ?? 'GET').toUpperCase()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true // safe verbs
  if (!origin) return true // native / CLI / server-to-server send no Origin
  return isLoopbackOrigin(origin)
}
