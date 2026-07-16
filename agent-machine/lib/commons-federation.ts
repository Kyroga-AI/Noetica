/**
 * commons-federation.ts — forward opened chats to the SHARED commons aggregator (commons-search), so an open chat
 * is findable by OTHER users' agents, not just its author's.
 *
 * This runs in the agent-machine (never the browser): the browser sends raw messages to the LOCAL publish handler,
 * the local gate produces the authoritative redacted text, and only THEN do we forward that redacted snapshot here.
 * The aggregator re-runs its own floor gate on ingest, so this is defense-in-depth, not the only redaction. The
 * browser never holds the instance token and never talks to the aggregator directly.
 *
 * Opt-in + fail-open-locally: if COMMONS_AGGREGATOR_URL isn't configured, federation is simply off and the local
 * commons still works. Every call is best-effort and never throws into the publish path — a down aggregator must
 * not break a user opening a chat; it just means the chat isn't in the shared corpus yet.
 *
 * Env: COMMONS_AGGREGATOR_URL (e.g. http://commons-search.socioprophet.svc.cluster.local:8080),
 *      COMMONS_PUBLISH_TOKEN (this instance's write token), COMMONS_SOVEREIGN_ID (the author pseudonym).
 */

interface AggregatorConfig { base: string; token: string; author: string }

function config(): AggregatorConfig | null {
  const base = (process.env['COMMONS_AGGREGATOR_URL'] ?? '').replace(/\/$/, '')
  const token = process.env['COMMONS_PUBLISH_TOKEN'] ?? ''
  const author = process.env['COMMONS_SOVEREIGN_ID'] ?? ''
  if (!base || !token || !author) return null   // federation not configured → local-only
  return { base, token, author }
}

export function federationEnabled(): boolean { return config() !== null }

/** Forward an already-redacted snapshot to the aggregator. Fire-and-forget; logs on failure, never throws. */
export function forwardPublish(sessionId: string, title: string, redacted: string): void {
  const cfg = config()
  if (!cfg) return
  void (async () => {
    try {
      const res = await fetch(`${cfg.base}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}`, 'x-sovereign-id': cfg.author },
        body: JSON.stringify({ sessionId, title, redacted }),
        signal: AbortSignal.timeout(8_000),
      })
      if (!res.ok) console.warn(`[commons-federation] publish ${sessionId} → HTTP ${res.status}`)
    } catch (e) {
      console.warn(`[commons-federation] publish ${sessionId} failed: ${e instanceof Error ? e.message : e}`)
    }
  })()
}

/** Forward a revoke to the aggregator (author-scoped there by our token). Best-effort; never throws. */
export function forwardRevoke(sessionId: string): void {
  const cfg = config()
  if (!cfg) return
  void (async () => {
    try {
      const res = await fetch(`${cfg.base}/api/open-chats/publish?session=${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${cfg.token}`, 'x-sovereign-id': cfg.author },
        signal: AbortSignal.timeout(8_000),
      })
      if (!res.ok) console.warn(`[commons-federation] revoke ${sessionId} → HTTP ${res.status}`)
    } catch (e) {
      console.warn(`[commons-federation] revoke ${sessionId} failed: ${e instanceof Error ? e.message : e}`)
    }
  })()
}
