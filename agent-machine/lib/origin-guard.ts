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
 * (or undefined when absent). A request with NO Origin (native / CLI / top-level navigation /
 * server-to-server) always passes; a request that DOES carry an Origin must be the local app.
 *
 * This applies to reads too, not just writes: with `Access-Control-Allow-Origin: *`, a foreign page the
 * user visits could otherwise `fetch()` this loopback server's GET endpoints (e.g. /api/library,
 * /api/graph/*) and read the user's knowledge graph cross-origin (DNS-rebinding / drive-by exfiltration).
 * OPTIONS (CORS preflight) still passes so the browser can learn the actual request is rejected.
 * Pure + side-effect-free so it's unit-testable.
 */
export function originAllowed(method: string | undefined, origin: string | undefined): boolean {
  const m = (method ?? 'GET').toUpperCase()
  if (m === 'OPTIONS') return true // CORS preflight must complete; the real request is still checked
  if (!origin) return true // native / CLI / top-level navigation / server-to-server send no Origin
  return isLoopbackOrigin(origin) // a PRESENT Origin must be the local app — for reads as well as writes
}
