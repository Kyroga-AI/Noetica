/**
 * library.ts — "what's been captured into the graph" (the Library view, like ChatGPT's library but for the
 * knowledge graph). Aggregates the graph + the collections registry into groups → documents → entity/chunk
 * counts, so the user can SEE what landed, where (which scope), and clean it up.
 *
 * One pass over Document + CanonicalEntity nodes (O(docs + entities)). Groups by scope (doc-scope.ts):
 * real document COLLECTIONS first (user uploads), then SYSTEM scopes (memory/knowledge/self) shown but marked
 * protected. This is the observability layer that would have made the "docs landed in memory" pollution obvious.
 */
import { scopeOf, collectionIdOf, isCoreScope } from './doc-scope.js'
import { listCollections } from './collections.js'

export interface LibraryDoc { docId: string; filename: string; name: string; chunks: number; entities: number }
export interface LibraryGroup {
  scope: string
  kind: 'collection' | 'system' | 'inbox'
  id?: string
  name: string
  source?: string
  createdAt?: string
  docCount: number
  chunkCount: number
  entityCount: number
  docs: LibraryDoc[]
}
export interface Library {
  groups: LibraryGroup[]
  totals: { collections: number; documents: number; chunks: number; entities: number }
}

const SYSTEM_NAMES: Record<string, string> = {
  memory: 'Memory', knowledge: 'Knowledge', self: 'Self-model', brain: 'Brain', repo: 'Repositories', episode: 'Episodes', inbox: 'Inbox',
}

export async function buildLibrary(): Promise<Library> {
  const { getGraph } = await import('./graph.js')
  const g = getGraph()
  const collMeta = new Map(listCollections().map((c) => [c.id, c]))
  const groups = new Map<string, LibraryGroup>()
  let totalDocs = 0, totalChunks = 0, totalEntities = 0

  for (const d of g.nodesByLabel('Document')) {
    const filename = String(d.properties['filename'] ?? '')
    if (!filename || d.properties['hidden']) continue   // skip soft-deleted (Library cleanup)
    const docId = d.id
    const chunks = Number(d.properties['chunk_count'] ?? 0)
    // Entities grounded from this doc = its GROUNDS out-edges (the Document→CanonicalEntity links from ingest).
    const entities = (() => { try { return g.out(docId, 'GROUNDS').length } catch { return 0 } })()
    const cid = collectionIdOf(filename)
    const key = cid ? `collection:${cid}` : scopeOf(filename)

    let grp = groups.get(key)
    if (!grp) {
      if (cid) {
        const c = collMeta.get(cid)
        grp = { scope: key, kind: 'collection', id: cid, name: c?.name ?? cid, source: c?.source, createdAt: c?.createdAt, docCount: 0, chunkCount: 0, entityCount: 0, docs: [] }
      } else {
        const seg = key.split(':')[0] ?? key
        grp = { scope: key, kind: isCoreScope(filename) ? 'system' : 'inbox', name: SYSTEM_NAMES[seg] ?? seg, docCount: 0, chunkCount: 0, entityCount: 0, docs: [] }
      }
      groups.set(key, grp)
    }
    grp.docs.push({ docId, filename, name: filename.split('/').pop() || filename, chunks, entities })
    grp.docCount += 1; grp.chunkCount += chunks; grp.entityCount += entities
    totalDocs += 1; totalChunks += chunks; totalEntities += entities
  }

  // Collections first (user's stuff), newest first; system scopes after.
  const rank = (k: LibraryGroup['kind']): number => (k === 'collection' ? 0 : k === 'inbox' ? 1 : 2)
  const groupList = [...groups.values()].sort((a, b) => rank(a.kind) - rank(b.kind) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.chunkCount - a.chunkCount)
  for (const grp of groupList) grp.docs.sort((a, b) => b.entities - a.entities)

  // Graph-wide entity total is reliable (every CanonicalEntity node); per-doc entity counts depend on the
  // Document→entity GROUNDS edges, which aren't created for interned/deduped entities yet — so per-doc shows 0
  // until that grounding-linkage is fixed. Report the real graph total so the Library reflects what's captured.
  const graphEntities = (() => { try { return g.nodesByLabel('CanonicalEntity').length } catch { return totalEntities } })()

  return {
    groups: groupList,
    totals: { collections: groupList.filter((g) => g.kind === 'collection').length, documents: totalDocs, chunks: totalChunks, entities: graphEntities },
  }
}
