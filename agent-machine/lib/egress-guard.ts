/**
 * egress-guard — the STRUCTURAL guarantee behind the zero-egress badge.
 *
 * In offline/sovereign mode (NOETICA_OFFLINE=1, "airplane mode"), wrap the global `fetch` so any
 * request to a non-localhost host THROWS — egress becomes impossible, not merely absent. Local
 * calls (the managed Ollama on 127.0.0.1, the embed sidecar, the AM itself) pass through
 * untouched. This is what turns "🔒 0 left this device" from a claim into a tested guarantee:
 * with the guard armed, no code path — model call, web_search, telemetry, a stray dependency —
 * can reach the network.
 *
 * The decision (`shouldBlockEgress`) is pure + unit-tested; `installEgressGuard` applies it.
 */

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0', ''])

let offline = false
let blocked = 0
let installed = false

export function setOfflineMode(on: boolean): void { offline = on }
export function isOfflineMode(): boolean { return offline }
export function blockedEgressCount(): number { return blocked }

/** Pure: should this URL be blocked given the offline flag? Localhost is always allowed. */
export function shouldBlockEgress(url: string, isOffline = offline): boolean {
  if (!isOffline) return false
  let host: string
  try { host = new URL(url, 'http://localhost').hostname.toLowerCase().replace(/^\[|\]$/g, '') } catch { return false }
  return !(LOCAL_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.localhost'))
}

/** Wrap global fetch once so offline mode physically refuses non-local egress. Idempotent. */
export function installEgressGuard(): void {
  if (installed || typeof globalThis.fetch !== 'function') return
  installed = true
  const orig = globalThis.fetch.bind(globalThis)
  const wrapped = (input: unknown, init?: unknown) => {
    const url = typeof input === 'string' ? input
      : input instanceof URL ? input.href
      : (input as { url?: string })?.url ?? String(input)
    if (shouldBlockEgress(url)) {
      blocked++
      let host = url; try { host = new URL(url, 'http://localhost').hostname } catch { /* keep raw */ }
      return Promise.reject(new Error(`EGRESS BLOCKED (offline/sovereign mode): refused to contact ${host}`))
    }
    return (orig as (i: unknown, n?: unknown) => Promise<Response>)(input, init)
  }
  globalThis.fetch = wrapped as unknown as typeof fetch
}
