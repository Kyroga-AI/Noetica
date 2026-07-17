/**
 * graph-replica — binds the CRDT sync replica (sync-engine.ts) to the live in-process HellGraph.
 *
 * The wire (http-sync.ts) reconciles Replicas; this is what makes a Replica REFLECT real graph state:
 *   capture: local HellGraph structure → new CRDT ops (so local mutations sync OUT)
 *   apply:   the replica's converged structure → HellGraph nodes/edges (so peer data lands IN)
 * S0 scope per the design (edge-service-sync-design.md): the GRAPH STRUCTURE (nodes + edges) — derived
 * artifacts (GDS/GraphRAG) are recomputed locally, never synced. Engine-agnostic: takes a GraphLike so it
 * is unit-testable without a live AtomSpace.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { type Replica, createReplica, addNode, addEdge, presentNodes, presentEdges } from './sync-engine.js'

export interface GraphLike {
  allNodes(): Array<{ id: string }>
  allEdges(): Array<{ from: string; label: string; to: string }>
  addNode(id: string, labels: string[], properties?: Record<string, never>): unknown
  addEdge(label: string, from: string, to: string, properties?: Record<string, never>): unknown
}

// Edge keys are "from label to" (single-token ids/labels — true for atom ids like proj-x:ent:foo).
function presentEdgesWithLabel(r: Replica): Array<{ from: string; label: string; to: string }> {
  return [...r.edgeTags.keys()].map((key) => {
    const p = key.split(' ')
    return { from: p[0]!, label: p[1] ?? 'rel', to: p[2]! }
  })
}

/** New local graph STRUCTURE → CRDT ops, so it syncs out. Returns count of ops produced. Idempotent. */
export function captureGraphIntoReplica(r: Replica, g: GraphLike): number {
  let n = 0
  const haveNodes = new Set(presentNodes(r))
  for (const node of g.allNodes()) if (!haveNodes.has(node.id)) { addNode(r, node.id); n++ }
  const haveEdges = new Set(presentEdges(r).map((e) => `${e.from}|${e.to}`))
  for (const e of g.allEdges()) { const k = `${e.from}|${e.to}`; if (!haveEdges.has(k)) { addEdge(r, e.from, e.label, e.to); n++ } }
  return n
}

/** The replica's converged STRUCTURE → HellGraph (peer data lands locally). Returns count applied. Idempotent. */
export function applyReplicaToGraph(r: Replica, g: GraphLike): number {
  let n = 0
  const have = new Set(g.allNodes().map((x) => x.id))
  for (const id of presentNodes(r)) if (!have.has(id)) { g.addNode(id, ['synced'], {} as Record<string, never>); n++ }
  const haveE = new Set(g.allEdges().map((e) => `${e.from}|${e.to}`))
  for (const e of presentEdgesWithLabel(r)) { const k = `${e.from}|${e.to}`; if (!haveE.has(k)) { g.addEdge(e.label, e.from, e.to, {} as Record<string, never>); n++ } }
  return n
}

// ── singleton replica (persisted structure only; the CRDT log is rebuilt from capture on load) ──
let _replica: Replica | null = null
const FILE = path.join(os.homedir(), '.noetica', 'graph-replica.json')

export function getGraphReplica(id?: string): Replica {
  if (_replica) return _replica
  const rid = id || process.env['GRAPH_SYNC_SOVEREIGN_ID'] || 'local'
  _replica = createReplica(rid)
  try {
    if (fs.existsSync(FILE)) {
      const saved = JSON.parse(fs.readFileSync(FILE, 'utf8')) as { nodes?: string[]; edges?: [string, string, string][] }
      for (const nid of saved.nodes ?? []) addNode(_replica, nid)
      for (const [f, l, t] of saved.edges ?? []) addEdge(_replica, f, l, t)
    }
  } catch { /* fail-open: start empty */ }
  return _replica
}

/** Persist the replica's present structure (compact; the op-log is regenerated on load). */
export function saveGraphReplica(r: Replica): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    const edges = presentEdgesWithLabel(r).map((e) => [e.from, e.label, e.to])
    fs.writeFileSync(FILE, JSON.stringify({ nodes: presentNodes(r), edges }))
  } catch { /* fail-open */ }
}
