/**
 * web-gateway — the browser tier for a hosted Noetica launch.
 *
 * The desktop app loads a static export from tauri://localhost and reaches the API only on the
 * loopback sidecar (127.0.0.1:8080). For a browser launch we need ONE origin that:
 *   1. serves the built static UI (the Next `out/` export) to a browser, and
 *   2. reverse-proxies the ENTIRE /api/* (and /health) surface to the agent-machine sidecar —
 *      which exposes the complete ~190-route platform + workspace API.
 *
 * Going straight to the sidecar (rather than the ~25 Next app/api route handlers, which were
 * themselves just localhost proxies) means the browser gets the full API with no per-route shim.
 *
 * Zero runtime dependencies (node:http only) so it ships as a tiny container and has nothing to
 * audit. TLS + multi-tenant auth terminate in front of this (ingress/load balancer); this process
 * is the static+proxy tier, deliberately small.
 *
 * Env:
 *   GATEWAY_PORT        port to listen on (default 8088)
 *   GATEWAY_HOST        bind host (default 0.0.0.0 — it's the public tier, behind ingress)
 *   NOETICA_AM_ENDPOINT sidecar base URL (default http://127.0.0.1:8080)
 *   GATEWAY_STATIC_DIR  directory of the built static UI (default ../../out relative to this file)
 */
import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { join, normalize, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const PORT = parseInt(process.env['GATEWAY_PORT'] ?? '8088', 10)
const HOST = process.env['GATEWAY_HOST'] ?? '0.0.0.0'
const AM_ENDPOINT = (process.env['NOETICA_AM_ENDPOINT'] ?? 'http://127.0.0.1:8080').replace(/\/$/, '')
const STATIC_DIR = process.env['GATEWAY_STATIC_DIR'] ?? join(__dirname, '..', '..', 'out')

/** Paths that must be reverse-proxied to the sidecar rather than served from static files. */
export function shouldProxy(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname === '/health'
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.webp': 'image/webp', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
}

/** Resolve a request path to a file inside STATIC_DIR, guarding against traversal. */
export function resolveStaticPath(pathname, staticDir = STATIC_DIR) {
  // Decode, strip query, normalize, and confine to staticDir (no ../ escape).
  let p = pathname
  try { p = decodeURIComponent(pathname) } catch { /* keep raw */ }
  const rel = normalize(p).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '')
  const abs = join(staticDir, rel)
  if (!abs.startsWith(staticDir)) return null // traversal attempt
  return abs
}

function proxyToSidecar(req, res) {
  const target = new URL(AM_ENDPOINT)
  const options = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: target.host },
  }
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
    proxyRes.pipe(res)
  })
  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'bad_gateway', detail: String(err.message ?? err) }))
  })
  req.pipe(proxyReq)
}

function serveStatic(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  let abs = resolveStaticPath(url.pathname)
  if (!abs) { res.writeHead(403); res.end('forbidden'); return }

  // Directory or extension-less route → serve the file, else index.html (SPA fallback).
  if (!existsSync(abs) || (existsSync(abs) && statSync(abs).isDirectory())) {
    const asHtml = abs + '.html'
    if (existsSync(asHtml) && statSync(asHtml).isFile()) {
      abs = asHtml
    } else {
      const indexInDir = join(abs, 'index.html')
      abs = existsSync(indexInDir) ? indexInDir : join(STATIC_DIR, 'index.html')
    }
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return
  }
  const type = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream'
  res.writeHead(200, { 'content-type': type })
  createReadStream(abs).pipe(res)
}

export function createGateway() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    if (shouldProxy(url.pathname)) return proxyToSidecar(req, res)
    return serveStatic(req, res)
  })
}

// Start only when run directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createGateway().listen(PORT, HOST, () => {
    console.log(`[web-gateway] serving ${STATIC_DIR} on http://${HOST}:${PORT}`)
    console.log(`[web-gateway] proxying /api/* + /health → ${AM_ENDPOINT}`)
  })
}
