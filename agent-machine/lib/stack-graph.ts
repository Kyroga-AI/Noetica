/**
 * stack-graph — ingest the build-time stack manifest (canon/stack-index.json) into HellGraph as CodeModule atoms
 * + IMPORTS edges, so the graph's "Tech" lens shows OUR actual codebase (modules + dependency structure) instead
 * of doc-derived concepts. The JSON is IMPORTED (not fs-read) so it bundles into the compiled binary and works
 * in prod where there's no source tree at runtime. Idempotent — a no-op once ingested.
 */
import { getHellGraph } from '@socioprophet/hellgraph'
import stack from '../canon/stack-index.json'

interface StackIndex {
  modules: Array<{ id: string; rel: string; name: string; kind: string }>
  imports: Array<{ from: string; to: string }>
}

export function ingestStackIndex(): { modules: number; edges: number } {
  const g = getHellGraph()
  const idx = stack as StackIndex
  if (!idx.modules?.length) return { modules: 0, edges: 0 }
  const existing = new Set(g.nodesByLabel('CodeModule').map((n) => n.id))
  if (existing.size >= idx.modules.length) return { modules: 0, edges: 0 }   // already ingested
  const now = new Date().toISOString()
  let modules = 0
  for (const m of idx.modules) {
    if (existing.has(m.id)) continue
    try { g.addNode(m.id, ['CodeModule'], { name: m.name, surface: m.name, rel: m.rel, code_kind: m.kind, created_at: now }); modules++ } catch { /* */ }
  }
  let edges = 0
  for (const e of idx.imports) {
    try { g.addEdge('IMPORTS', e.from, e.to, { kind: 'import' }); edges++ } catch { /* */ }
  }
  return { modules, edges }
}
