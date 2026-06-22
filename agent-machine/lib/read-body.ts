/**
 * read-body — the ONE request-body reader for the route handlers, with a hard size cap.
 *
 * storage-node-routes, meshrush-bridge, and cairnpath-adapter each had a byte-identical `readBody` that
 * accumulated `req.on('data')` into a string with NO cap — so their POST routes could be driven to buffer
 * an unbounded body into memory (only the global server guard bounded them, and these are mounted ahead of
 * it). This shared reader rejects (and destroys the socket) past `max`, so no single handler can be OOM'd.
 */
import type * as http from 'node:http'

const DEFAULT_MAX = 8 * 1024 * 1024 // 8 MB — control-plane bodies (atoms, sessions, lines), not uploads

export function readBody(req: http.IncomingMessage, max = DEFAULT_MAX): Promise<string> {
  return new Promise((resolve, reject) => {
    let d = ''
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > max) { req.destroy(); reject(new Error('request body too large')); return }
      d += c.toString()
    })
    req.on('end', () => resolve(d))
    req.on('error', reject)
  })
}
