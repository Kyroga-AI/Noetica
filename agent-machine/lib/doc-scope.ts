/**
 * doc-scope.ts — graph SCOPES via the document namespace (chosen because `filename` is the one field reliably
 * carried on every chunk; HellGraph is a single physical AtomSpace, so we partition it logically here).
 *
 * Every ingested doc's filename is namespaced `<scope>/<path>`. CORE scopes are PROTECTED — bulk document
 * ingestion never writes into them, and user-document retrieval never reads from them, so uploading a
 * collection can't pollute (or be polluted by) memory/knowledge/self. User uploads land in `collection/<id>/…`.
 * This is the same mechanism that fixed the self-doc refusal (self/ excluded), generalized.
 */

/** Reserved, protected namespaces. Bulk ingest MUST NOT target these; user-doc RAG MUST exclude them. */
export const CORE_SCOPES = ['self', 'memory', 'knowledge', 'brain', 'repo', 'episode'] as const

/** The scope (first namespace segment) of a doc filename. Bare names (legacy single-file uploads) → 'inbox'. */
export function scopeOf(filename: string): string {
  const seg = (filename || '').split('/')[0] ?? ''
  if (!seg || seg === filename) return 'inbox'
  return seg === 'collection' ? `collection:${(filename.split('/')[1] ?? 'default')}` : seg
}

/** A core/protected scope (memory/knowledge/self/…)? These are off-limits to document RAG. */
export function isCoreScope(filename: string): boolean {
  const seg = (filename || '').split('/')[0] ?? ''
  return (CORE_SCOPES as readonly string[]).includes(seg)
}

/** A USER document (any non-core scope: collections, legacy chats/, bare uploads)? */
export function isUserDoc(filename: string): boolean {
  return !isCoreScope(filename)
}

/** Namespaced filename for a file in a collection: `collection/<id>/<path>`. */
export function collectionPath(collectionId: string, path: string): string {
  const clean = path.replace(/^\/+/, '')
  return `collection/${collectionId}/${clean}`
}

/** The collection id of a filename, or null if it isn't collection-scoped. */
export function collectionIdOf(filename: string): string | null {
  const parts = (filename || '').split('/')
  return parts[0] === 'collection' && parts[1] ? parts[1] : null
}

/** Does this filename belong to the given collection? (used to scope retrieval to an active collection) */
export function inCollection(filename: string, collectionId: string): boolean {
  return collectionIdOf(filename) === collectionId
}
