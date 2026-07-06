/**
 * StorageNode HTTP API — makes the local AtomSpace network-accessible.
 *
 * Implements the distributed federation layer for HellGraph AtomSpace:
 *   GET  /api/atomspace/stats           atom count, type distribution
 *   GET  /api/atomspace/atom/:handle    fetch atom by handle
 *   POST /api/atomspace/fetch           batch fetch by handles
 *   GET  /api/atomspace/by-type/:type   all atoms of a type
 *   GET  /api/atomspace/incoming/:handle  incoming-set for a handle
 *   GET  /api/atomspace/stream          SSE change feed (real-time replication)
 *   POST /api/atomspace/sync            push atom batch (import from peer)
 *
 * Design: follows the OpenCog rocks-storage-node protocol translated to HTTP.
 * The SSE stream carries AtomChangeEvent payloads; clients call importEntry()
 * on their local AtomSpace to merge remote atoms (CRDT-safe: handles are
 * content-addressed so duplicate adds are idempotent).
 */

import * as http from 'node:http'
import { readBody } from './read-body.js' // shared, size-capped (was an unbounded local copy)
import type { AtomSpace } from '@socioprophet/hellgraph'
import type { AtomChangeEvent, AtomLogEntry } from '@socioprophet/hellgraph'

// ─── SSE client registry ─────────────────────────────────────────────────────

const _streamClients = new Set<http.ServerResponse>()

function broadcastChange(event: AtomChangeEvent): void {
  const msg = `data: ${JSON.stringify(event)}\n\n`
  for (const res of _streamClients) {
    try {
      (res as unknown as { write: (s: string) => void }).write(msg)
    } catch {
      _streamClients.delete(res)
    }
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export function registerStorageNodeRoutes(space: AtomSpace): void {
  // Wire the change feed: any mutation emits to all SSE subscribers.
  space.on('change', (event: AtomChangeEvent) => broadcastChange(event))
}

// ─── Per-request handler ─────────────────────────────────────────────────────
// Called from the main HTTP server's request handler.

export function handleStorageNodeRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  space: AtomSpace,
): boolean {
  const setCORS = () => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
  }

  // GET /api/atomspace/stats
  if (req.method === 'GET' && pathname === '/api/atomspace/stats') {
    setCORS()
    const all = space.allAtoms()
    const typeMap: Record<string, number> = {}
    for (const a of all) typeMap[a.type] = (typeMap[a.type] ?? 0) + 1
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      total: all.length,
      nodes: space.nodeCount(),
      links: space.linkCount(),
      types: typeMap,
      logicalClock: space.logicalClock,
      storagePath: space.storagePath,
    }))
    return true
  }

  // GET /api/atomspace/atom/:handle
  if (req.method === 'GET' && pathname.startsWith('/api/atomspace/atom/')) {
    setCORS()
    const handle = decodeURIComponent(pathname.slice('/api/atomspace/atom/'.length))
    const atom = space.getAtom(handle)
    if (!atom) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not_found' }))
    } else {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(atom))
    }
    return true
  }

  // POST /api/atomspace/fetch  — batch fetch by handles
  if (req.method === 'POST' && pathname === '/api/atomspace/fetch') {
    setCORS()
    readBody(req).then((body) => {
      try {
        const { handles } = JSON.parse(body) as { handles: string[] }
        if (!Array.isArray(handles) || handles.length === 0) throw new Error('handles array required and non-empty')
        if (handles.length > 1000) throw new Error('handles exceeds maximum batch size of 1,000')
        const atoms = handles.map((h) => space.getAtom(h)).filter(Boolean)
        const missing = handles.filter((_, i) => !space.getAtom(handles[i]!))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ atoms, count: atoms.length, ...(missing.length > 0 ? { missing } : {}) }))
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'error' }))
      }
    }).catch(() => { res.writeHead(500); res.end() })
    return true
  }

  // GET /api/atomspace/by-type/:type
  if (req.method === 'GET' && pathname.startsWith('/api/atomspace/by-type/')) {
    setCORS()
    const type = decodeURIComponent(pathname.slice('/api/atomspace/by-type/'.length))
    const includeSubtypes = true
    const atoms = space.getByType(type, includeSubtypes)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ atoms, count: atoms.length }))
    return true
  }

  // GET /api/atomspace/incoming/:handle
  if (req.method === 'GET' && pathname.startsWith('/api/atomspace/incoming/')) {
    setCORS()
    const handle = decodeURIComponent(pathname.slice('/api/atomspace/incoming/'.length))
    const links = space.getIncoming(handle)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ links, count: links.length }))
    return true
  }

  // GET /api/atomspace/stream  — SSE change feed for distributed replication
  if (req.method === 'GET' && pathname === '/api/atomspace/stream') {
    res.writeHead(200, {
      'content-type':                'text/event-stream; charset=utf-8',
      'cache-control':               'no-cache',
      'connection':                  'keep-alive',
      'access-control-allow-origin': '*',
      'x-atomspace-id':              space.id,
      'x-logical-clock':             String(space.logicalClock),
    })
    // Evict oldest client if pool is full to prevent unbounded memory growth.
    const MAX_SSE_CLIENTS = 100
    if (_streamClients.size >= MAX_SSE_CLIENTS) {
      const oldest = _streamClients.values().next().value as http.ServerResponse | undefined
      if (oldest) {
        _streamClients.delete(oldest)
        try { oldest.end() } catch { /* already closed */ }
        console.warn('[storage-node] SSE client pool full — evicted oldest client')
      }
    }
    res.write('data: {"type":"connected","spaceId":"' + space.id + '"}\n\n')
    _streamClients.add(res)
    const heartbeat = setInterval(() => {
      try { (res as unknown as { write: (s: string) => void }).write(':hb\n\n') }
      catch { clearInterval(heartbeat); _streamClients.delete(res) }
    }, 15_000)
    req.on('close', () => { clearInterval(heartbeat); _streamClients.delete(res) })
    return true
  }

  // POST /api/atomspace/sync  — bulk import from a peer (idempotent)
  if (req.method === 'POST' && pathname === '/api/atomspace/sync') {
    setCORS()
    readBody(req).then((body) => {
      try {
        const { entries, source } = JSON.parse(body) as { entries: AtomLogEntry[]; source?: string }
        if (!Array.isArray(entries)) throw new Error('entries array required')
        if (entries.length > 10_000) throw new Error('entries exceeds maximum batch size of 10,000')
        const importedAt = new Date().toISOString()
        const peerSource = source ?? req.headers['x-atomspace-id'] ?? 'unknown'
        let imported = 0
        const failed: Array<{ index: number; error: string }> = []
        for (let i = 0; i < entries.length; i++) {
          try {
            space.importEntry(entries[i]!)
            // Tag each imported atom with federation provenance
            if (entries[i]!.op === 'add_atom' && entries[i]!.payload['handle']) {
              const h = entries[i]!.payload['handle'] as string
              space.setValue(h, 'federation:source',      { kind: 'string', value: [String(peerSource)] })
              space.setValue(h, 'federation:imported_at', { kind: 'string', value: [importedAt] })
            }
            imported++
          } catch (e) {
            failed.push({ index: i, error: (e as Error).message })
          }
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          imported,
          total: entries.length,
          ...(failed.length > 0 ? { failed } : {}),
        }))
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'error' }))
      }
    }).catch(() => { res.writeHead(500); res.end() })
    return true
  }

  // GET /api/atomspace/handles  — all known atom handles (Bloom filter seed / diff)
  // Clients use this to identify which atoms are missing locally before a targeted fetch.
  if (req.method === 'GET' && pathname === '/api/atomspace/handles') {
    setCORS()
    const all = space.allAtoms()
    // Return compact array of handles — clients can build their own Bloom filter
    const handles = all.map(a => a.handle)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      handles,
      count: handles.length,
      seq: space.logicalClock,
      space_id: space.id,
    }))
    return true
  }

  return false // not an atomspace route
}

