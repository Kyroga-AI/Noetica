/**
 * oauth-token-routes.ts — OAuth token-exchange proxies, served by the agent-machine sidecar.
 *
 * WHY THIS EXISTS: the packaged desktop app is a Next.js STATIC EXPORT (NOETICA_STATIC_EXPORT=1), which
 * strips every `app/api/*` server route. The browser OAuth flow (lib/auth/providers/*) needs a server-side
 * token exchange for GitHub/Slack/Notion/Linear (PKCE/code → access_token must not run in the page, and CORS
 * blocks calling the providers' token endpoints directly). Those proxies used to live in app/api/oauth/*,
 * so they vanished in the shipped build → "token exchange failed" → logins broken. The sidecar IS running in
 * the packaged app (it serves /api/graph/*, /api/cap/* …), so we serve the proxies here instead. Google and
 * Matrix don't need a proxy (direct token endpoint / homeserver) and are unaffected.
 *
 * SECURITY: this is a loopback-only proxy. We forward exactly the documented token-exchange fields to the
 * provider's well-known token URL — no arbitrary URL, no echoing secrets back to the caller.
 */
import type * as http from 'http'

const TOKEN_URL: Record<string, string> = {
  github: 'https://github.com/login/oauth/access_token',
  slack: 'https://slack.com/api/oauth.v2.access',
  linear: 'https://api.linear.app/oauth/token',
  notion: 'https://api.notion.com/v1/oauth/token',
}

const MAX_BODY = 64 * 1024   // token-exchange bodies are tiny; cap to stop abuse

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = ''; let size = 0; let aborted = false
    req.on('data', (c: Buffer) => {
      if (aborted) return
      size += c.length
      if (size > MAX_BODY) { aborted = true; resolve(''); try { req.destroy() } catch { /* ignore */ } return }
      b += c.toString()
    })
    req.on('end', () => { if (!aborted) resolve(b) })
    req.on('error', () => resolve(''))
  })
}

/** Returns true if it handled the route. Mirrors the old app/api/oauth/<provider>/token proxies. */
export async function handleOAuthTokenRoute(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  const m = /^\/api\/oauth\/([a-z]+)\/token$/.exec(url.pathname)
  if (!m) return false
  const provider = m[1]!
  const send = (code: number, obj: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
  if (req.method !== 'POST') { send(405, { error: 'method_not_allowed' }); return true }
  const tokenUrl = TOKEN_URL[provider]
  if (!tokenUrl) { send(404, { error: 'unknown_provider' }); return true }

  const params = new URLSearchParams(await readBody(req))
  try {
    let upstream: Response
    if (provider === 'notion') {
      // Notion requires HTTP Basic (client_id:client_secret) + a JSON body; the secret must NOT round-trip back.
      const clientId = params.get('client_id') ?? ''
      const clientSecret = params.get('client_secret') ?? ''
      params.delete('client_secret')
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
      upstream = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basic}` },
        body: JSON.stringify(Object.fromEntries(params)),
      })
    } else {
      // GitHub/Slack/Linear: form-encoded; GitHub needs Accept: application/json to get JSON not querystring.
      upstream = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: params.toString(),
      })
    }
    if (!upstream.ok) { send(502, { error: 'upstream_error', status: upstream.status }); return true }
    const data = await upstream.json().catch(() => ({}))
    if (data && typeof data === 'object' && 'error' in data) { send(400, data); return true }
    send(200, data)
  } catch {
    send(502, { error: 'upstream_unreachable' })
  }
  return true
}
