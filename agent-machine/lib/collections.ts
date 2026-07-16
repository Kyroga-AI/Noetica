/**
 * collections.ts — registry of document COLLECTIONS (a ZIP, a batch upload = one collection).
 *
 * A collection is a named scope under `collection/<id>/…` (see doc-scope.ts). The registry is metadata only —
 * the docs live in HellGraph under that namespace; deleting a collection's atoms is a separate graph op.
 * Persisted, encrypted-at-rest.
 */
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const STORE = path.join(os.homedir(), '.noetica', 'collections.json')

export interface Collection {
  id: string
  name: string
  source?: string          // e.g. the zip filename, or 'upload'
  createdAt: string
  docCount: number         // files enqueued into it (best-effort)
}

// Keyed by a caller-supplied collection id → hold it in a Map, not a plain object,
// so an id like "__proto__"/"constructor" can't inject onto Object.prototype
// (js/remote-property-injection). Serialize via Object.fromEntries at the boundary.
let cache: Map<string, Collection> | null = null
function load(): Map<string, Collection> {
  if (cache) return cache
  try { const { readJson } = require('./at-rest.js') as typeof import('./at-rest.js'); cache = new Map(Object.entries(readJson<Record<string, Collection>>(STORE) ?? {})) }
  catch { cache = new Map() }
  return cache
}
function persist(): void {
  const obj = Object.fromEntries(cache ?? new Map<string, Collection>())
  try { const { writeJson } = require('./at-rest.js') as typeof import('./at-rest.js'); writeJson(STORE, obj) }
  catch { try { fs.mkdirSync(path.dirname(STORE), { recursive: true }); fs.writeFileSync(STORE, JSON.stringify(obj)) } catch { /* in-memory only */ } }
}

/** Stable catch-all collection for loose single-file drops. */
export const INBOX_ID = 'inbox'

export function createCollection(name: string, source?: string): Collection {
  const id = randomUUID().slice(0, 8)
  const c: Collection = { id, name: name || 'Untitled collection', source, createdAt: new Date().toISOString(), docCount: 0 }
  const led = load(); led.set(id, c); persist()
  return c
}

/** Get a collection, creating it on first use (used for the stable Inbox). */
export function ensureCollection(id: string, name: string): Collection {
  const led = load()
  if (!led.has(id)) { led.set(id, { id, name, createdAt: new Date().toISOString(), docCount: 0 }); persist() }
  return led.get(id)!
}

/**
 * Register a collection under a CALLER-supplied id, or rename it if it already exists — the upsert the Projects
 * layer needs so a `proj-<id>` collection carries the project's TITLE (not a bare id) in the Library, and follows
 * a project rename. Unlike ensureCollection it keeps the name current; unlike createCollection it does not mint a
 * random id (a project's collection id is DERIVED from the project id, see projectCollectionId). The id is a plain
 * string key held in a Map, so a hostile "__proto__" can't reach Object.prototype.
 */
export function registerCollection(id: string, name: string, source?: string): Collection {
  const led = load()
  const existing = led.get(id)
  if (existing) {
    if (name && existing.name !== name) { existing.name = name; if (source) existing.source = source; persist() }
    return existing
  }
  const c: Collection = { id, name: name || 'Untitled', source, createdAt: new Date().toISOString(), docCount: 0 }
  led.set(id, c); persist()
  return c
}

export function listCollections(): Collection[] {
  return [...load().values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
export function getCollection(id: string): Collection | undefined { return load().get(id) }
export function bumpDocCount(id: string, n = 1): void { const led = load(); const c = led.get(id); if (c) { c.docCount += n; persist() } }
export function deleteCollection(id: string): void { const led = load(); led.delete(id); persist() }
