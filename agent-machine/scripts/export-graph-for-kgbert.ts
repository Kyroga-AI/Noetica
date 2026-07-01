/**
 * export-graph-for-kgbert — dump the live HellGraph into a KG-BERT-ready corpus.
 *
 * KG-BERT (Yao et al. 2019) treats a knowledge triple (head, relation, tail) as a SENTENCE:
 * it concatenates the textual surface of the head entity, the relation, and the tail entity and
 * feeds that to a transformer. This exporter produces exactly that surface from the agent-machine's
 * real graph — NOT a synthetic one — so the Python encoder (kg-bert-encode.py) can learn over the
 * entities and hyperedges we ACTUALLY discovered (the user's directive: "run a KG-BERT encoder over
 * all the entities and hyper edges that we discover in that local graph").
 *
 * Three artifacts (JSONL, into ~/.noetica/kg/):
 *   entities.jsonl     {id, label, kind, text}                      — one per node, with a human surface
 *   triples.jsonl      {h, r, t, h_text, r_text, t_text}            — binary edges as KG-BERT sentences
 *   hyperedges.jsonl   {connector, connector_text, args:[{role,text}]} — n-ary, reconstructed around
 *                                                                       reified event/relation nodes
 *
 * Hyperedge reconstruction: the store is binary, but Graphbrain-style n-ary facts are reified — an
 * event node (Interaction, Run, Dispatch, Claim, Proof, …) is the connector and its incident edges are
 * the typed arguments. We regroup those into one hyperedge per event node, which is the faithful
 * "hyper edge we discover in that local graph".
 *
 * Usage:
 *   node --import tsx scripts/export-graph-for-kgbert.ts            # full export
 *   node --import tsx scripts/export-graph-for-kgbert.ts --limit 2000 --out /tmp/kg   # smoke
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { getGraph } from '../lib/graph.js'

type GNode = { id: string; labels: string[]; properties: Record<string, unknown>; createdAt?: string }
type GEdge = { id: string; label: string; from: string; to: string; properties: Record<string, unknown> }

// Event/relation node labels that act as n-ary CONNECTORS once reified — their incident edges are args.
const CONNECTOR_LABELS =
  /Interaction|Conversation|Message|Run|Dispatch|Event|Claim|Proof|Episode|Decision|Remediation|Release|Proposal|Candidate/i

// Humanize a node into the surface KG-BERT reads. Prefer an explicit term/name/title/label property,
// then a readable urn tail, then the primary type label. Never emit a raw hash.
function nodeText(n: GNode): string {
  const p = n.properties || {}
  for (const k of ['term', 'name', 'title', 'label', 'text', 'objective', 'definition']) {
    const v = p[k]
    if (typeof v === 'string' && v.trim() && !/^[0-9a-f]{8,}$/i.test(v.trim())) return v.trim()
  }
  // urn:regis:foo-bar:123 → "foo bar" (drop numeric/hex/UUID id segments — they're not knowledge)
  const isHashy = (s: string) => /^\d+$/.test(s) || /^[0-9a-f]{8,}$/i.test(s) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  const tail = n.id.split(':').filter((s) => s && !isHashy(s)).pop() || ''
  const human = isHashy(tail) ? '' : tail.replace(/[-_]/g, ' ').trim()
  const kind = (n.labels && n.labels[0]) || 'Node'
  return human && human.toLowerCase() !== kind.toLowerCase() ? `${kind}: ${human}` : kind
}

// Humanize an edge relation label: HAS_INTERACTION → "has interaction".
function relText(label: string): string {
  return (label || 'related to').replace(/[_-]+/g, ' ').trim().toLowerCase()
}

function arg(...parts: string[]): string { return parts.join(' ') }

function main() {
  const args = process.argv.slice(2)
  const limit = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1], 10) : Infinity })()
  const outDir = (() => { const i = args.indexOf('--out'); return i >= 0 ? args[i + 1] : path.join(os.homedir(), '.noetica', 'kg') })()
  fs.mkdirSync(outDir, { recursive: true })

  const g = getGraph()
  const nodes = (g.allNodes() as GNode[]).slice(0, limit)
  const edges = (g.allEdges() as GEdge[])
  const byId = new Map(nodes.map((n) => [n.id, n]))
  // when --limit trims nodes, keep only edges whose endpoints both survived (so texts resolve)
  const keptEdges = edges.filter((e) => byId.has(e.from) && byId.has(e.to))

  // 1) entities.jsonl
  const entF = fs.createWriteStream(path.join(outDir, 'entities.jsonl'))
  for (const n of nodes) {
    entF.write(JSON.stringify({ id: n.id, label: (n.labels && n.labels[0]) || 'Node', kind: n.labels || [], text: nodeText(n) }) + '\n')
  }
  entF.end()

  // 2) triples.jsonl — every kept binary edge as a KG-BERT sentence
  const triF = fs.createWriteStream(path.join(outDir, 'triples.jsonl'))
  for (const e of keptEdges) {
    const h = byId.get(e.from)!, t = byId.get(e.to)!
    triF.write(JSON.stringify({
      h: e.from, r: e.label, t: e.to,
      h_text: nodeText(h), r_text: relText(e.label), t_text: nodeText(t),
      sentence: arg(nodeText(h), relText(e.label), nodeText(t)),
    }) + '\n')
  }
  triF.end()

  // 3) hyperedges.jsonl — regroup ALL incident edges (both directions) around reified connector nodes into
  // n-ary facts. Reification points INTO the event node (Session -has_interaction-> Interaction <-produced- …),
  // so a connector's arguments are mostly its INCOMING edges; we take incoming AND outgoing and tag the role
  // with direction (←/→) so the n-ary neighbourhood is faithfully serialized for KG-BERT.
  const incident = new Map<string, Array<{ e: GEdge; dir: '→' | '←'; other: string }>>()
  const push = (id: string, e: GEdge, dir: '→' | '←', other: string) => {
    const a = incident.get(id) ?? incident.set(id, []).get(id)!
    a.push({ e, dir, other })
  }
  for (const e of keptEdges) { push(e.from, e, '→', e.to); push(e.to, e, '←', e.from) }
  const hypF = fs.createWriteStream(path.join(outDir, 'hyperedges.jsonl'))
  let hyperCount = 0
  for (const n of nodes) {
    const label = (n.labels && n.labels[0]) || ''
    if (!CONNECTOR_LABELS.test(label)) continue
    const inc = incident.get(n.id) || []
    if (inc.length < 2) continue                       // n-ary means ≥2 args, else it's just a triple
    const argsList = inc.map(({ e, dir, other }) => ({ role: `${dir}${relText(e.label)}`, text: nodeText(byId.get(other)!) }))
    const connectorText = nodeText(n)
    hypF.write(JSON.stringify({
      connector: n.id, connector_text: connectorText, arity: argsList.length, args: argsList,
      // KG-BERT n-ary serialization: connector then each (direction)role:arg
      sentence: `${connectorText} | ` + argsList.map((a) => `${a.role}: ${a.text}`).join(' ; '),
    }) + '\n')
    hyperCount++
  }
  hypF.end()

  process.stderr.write(
    `exported ${nodes.length} entities, ${keptEdges.length} triples, ${hyperCount} n-ary hyperedges → ${outDir}\n`,
  )
}

main()
