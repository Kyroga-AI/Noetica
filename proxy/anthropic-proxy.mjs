#!/usr/bin/env node
/**
 * anthropic-proxy — Branch B remote proxy for the Anthropic inference key (Work Order: API Key Integration).
 *
 * Deploy this on a server WE control (NOT in the desktop bundle — a shared key shipped on-device is extractable).
 * It holds the SHARED Anthropic key and forwards POST /v1/messages; clients authenticate with a per-user Bearer
 * token and NEVER see the key. The desktop app points NOETICA_ANTHROPIC_PROXY_URL at this server's /v1/messages
 * and sends NOETICA_PROXY_TOKEN as the Bearer token.
 *
 * Env (read at runtime only — never commit):
 *   ANTHROPIC_API_KEY   — the shared inference key (required; from your secret manager / env)
 *   PROXY_TOKENS        — comma-separated client bearer tokens allowed to use this proxy (required)
 *   PORT                — listen port (default 8788)
 *   MAX_REQS_PER_MIN    — per-token request cap per minute (default 120)
 *
 * Never logs the key or token values. No external deps (node http + global fetch).
 */
import http from 'node:http'

const KEY = process.env.ANTHROPIC_API_KEY
const TOKENS = new Set((process.env.PROXY_TOKENS ?? '').split(',').map((s) => s.trim()).filter(Boolean))
const PORT = Number(process.env.PORT ?? 8788)
const CAP = Number(process.env.MAX_REQS_PER_MIN ?? 120)
if (!KEY) { console.error('[anthropic-proxy] ANTHROPIC_API_KEY is required'); process.exit(1) }
if (TOKENS.size === 0) { console.error('[anthropic-proxy] PROXY_TOKENS is required (comma-separated client tokens)'); process.exit(1) }

// Naive per-token sliding-window rate cap (swap for a real limiter + token-accurate spend caps in prod).
const win = new Map() // token -> { start, n }
function allow(token) {
  const now = Date.now()
  const w = win.get(token) ?? { start: now, n: 0 }
  if (now - w.start > 60_000) { w.start = now; w.n = 0 }
  if (w.n >= CAP) return false
  w.n++; win.set(token, w); return true
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return }
  if (req.method !== 'POST' || req.url !== '/v1/messages') { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not_found"}'); return }

  const auth = String(req.headers['authorization'] ?? '')
  const tok = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!TOKENS.has(tok)) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"unauthorized"}'); return }
  if (!allow(tok)) { res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' }); res.end('{"error":"rate_limited"}'); return }

  let body = ''
  req.on('data', (c) => { body += c; if (body.length > 4_000_000) req.destroy() })
  req.on('end', () => { void (async () => {
    try {
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': KEY,                                   // the SHARED key — attached here, only here
          'anthropic-version': String(req.headers['anthropic-version'] ?? '2023-06-01'),
          ...(req.headers['anthropic-beta'] ? { 'anthropic-beta': String(req.headers['anthropic-beta']) } : {}),
        },
        body,
      })
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
      const reader = upstream.body?.getReader()
      if (reader) { for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(Buffer.from(value)) } }
      res.end()
    } catch {
      res.writeHead(502, { 'content-type': 'application/json' }); res.end('{"error":"upstream_error"}')   // never echo the key
    }
  })() })
})

server.listen(PORT, () => console.log(`[anthropic-proxy] listening on :${PORT} — forwards /v1/messages; key + tokens read from env`))
