/**
 * graph-writeback.ts — PERSIST derived knowledge back into HellGraph (not just compute + return). Accepted
 * graph-proposals and VERIFIED inferred facts become real nodes/edges in the store via addNode/addEdge, so
 * the graph actually grows. Writes are: additive only, idempotent (existing nodes/edges skipped), and
 * provenance-tagged (epistemic/source/rationale/created_at). Honors the GAIA invariant — model inference
 * alone must NOT be promoted to canonical truth, so only verified inferences are auto-written.
 *
 * The store is injected (defaults to the real HellGraph via getGraph()) so this is unit-testable with a fake.
 */
import { getGraph } from './graph.js'
import { proposalsFromInferred, type GraphProposal } from './graph-proposals.js'

export interface WritableGraph {
  getNode(id: string): unknown
  addNode(id: string, labels: string[], props: Record<string, unknown>): void
  addEdge(label: string, from: string, to: string, props: Record<string, unknown>): void
  allEdges(): Array<{ from: string; to: string; label: string }>
}

export interface WriteResult { written: number; skipped: number; details: Array<{ ref: string; op: string; status: string }> }

const edgeKey = (from: string, rel: string, to: string) => `${from}|${rel}|${to}`

/** Persist ACCEPTED proposals into HellGraph. Idempotent + provenance-tagged. */
export function persistProposals(proposals: GraphProposal[], opts: { store?: WritableGraph; now?: string } = {}): WriteResult {
  const g = opts.store ?? (getGraph() as unknown as WritableGraph)
  const now = opts.now ?? new Date().toISOString()
  const existing = new Set(g.allEdges().map((e) => edgeKey(e.from, e.label, e.to)))
  let written = 0, skipped = 0
  const details: WriteResult['details'] = []
  for (const p of proposals) {
    if (p.status !== 'accepted') { skipped++; continue }
    try {
      if (p.op === 'add-node') {
        const id = String(p.payload['id'] ?? p.payload['node'] ?? '')
        if (!id) { skipped++; details.push({ ref: '?', op: p.op, status: 'no-id' }); continue }
        if (g.getNode(id)) { skipped++; details.push({ ref: id, op: p.op, status: 'exists' }); continue }
        g.addNode(id, [String(p.payload['kind'] ?? 'Concept')], { label: String(p.payload['label'] ?? id), epistemic: 'proposed', source: p.source ?? 'agent', rationale: p.rationale, created_at: now })
        written++; details.push({ ref: id, op: p.op, status: 'written' })
      } else if (p.op === 'add-edge') {
        const from = String(p.payload['from'] ?? ''), to = String(p.payload['to'] ?? ''), rel = String(p.payload['rel'] ?? 'RELATED_TO')
        if (!from || !to) { skipped++; details.push({ ref: '?', op: p.op, status: 'missing-endpoint' }); continue }
        if (existing.has(edgeKey(from, rel, to))) { skipped++; details.push({ ref: edgeKey(from, rel, to), op: p.op, status: 'exists' }); continue }
        if (!g.getNode(from)) g.addNode(from, ['Concept'], { label: from, epistemic: 'proposed', created_at: now })
        if (!g.getNode(to)) g.addNode(to, ['Concept'], { label: to, epistemic: 'proposed', created_at: now })
        g.addEdge(rel, from, to, { epistemic: 'inferred', source: p.source ?? 'agent', rationale: p.rationale, created_at: now })
        existing.add(edgeKey(from, rel, to))
        written++; details.push({ ref: edgeKey(from, rel, to), op: p.op, status: 'written' })
      } else { skipped++; details.push({ ref: p.id, op: p.op, status: 'unsupported' }) }
    } catch { skipped++; details.push({ ref: p.id, op: p.op, status: 'error' }) }
  }
  return { written, skipped, details }
}

/** Persist ONLY verified inferred facts (GAIA invariant: unverified inference is not canonical → stays a proposal). */
export function persistInferred(inferred: Array<{ subject: string; predicate: string; object: string; via?: string; verified?: boolean }>, opts: { store?: WritableGraph; now?: string } = {}): WriteResult {
  const verified = inferred.filter((f) => f.verified)
  const proposals = proposalsFromInferred(verified).map((p) => ({ ...p, status: 'accepted' as const }))
  return persistProposals(proposals, opts)
}
