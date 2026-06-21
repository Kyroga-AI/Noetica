#!/usr/bin/env bun
/**
 * import-estate — load the estate TTLs (sociosphere, ontogenesis) into HellGraph as the ESTATE
 * tier, and BRIDGE them to the incident symbols so the graph stops being disjoint islands.
 *
 * HellGraph is RDF-native, so triples map straight to atoms:
 *   rdf:type  → node labels (Repository / RepoRole / Class …)
 *   literal o → node properties (label, techStack, org, role …)
 *   IRI     o → typed edges (upstreamContract, downstreamContract, role …)
 * Then the bridge links each incident ConceptNode `svc:<name>` to the estate component of the same
 * name (REALIZES edge) — so a failure symbol can be walked: symptom → component → contract → … .
 * That is the move that makes troubleshooting a graph traversal instead of three siloed lookups.
 *
 * Usage:  bun scripts/import-estate.ts <file.ttl ...> [--db PATH]
 *         INCIDENT_DB / --db default: the incident demo store, so estate + incidents share one graph.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { getAtomSpace, getHellGraph, parseTurtle } from '@socioprophet/hellgraph'
import type { RdfTerm } from '@socioprophet/hellgraph'
import { createSQLiteBackend } from '../lib/sqlite-backend.js'

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const local = (iri: string) => iri.split(/[#/]/).filter(Boolean).pop() || iri
const isLit = (t: RdfTerm) => t.kind === 'literal'

async function main() {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  if (!files.length) { console.error('usage: import-estate.ts <file.ttl ...> [--db PATH]'); process.exit(1) }
  const dbI = process.argv.indexOf('--db')
  const dbPath = dbI >= 0 ? process.argv[dbI + 1]! : process.env['INCIDENT_DB'] || path.join(os.homedir(), '.noetica', 'hellgraph', 'incident-demo.sqlite')
  const be = createSQLiteBackend(dbPath)
  if (be) { (getAtomSpace() as unknown as { setBackend(b: unknown): void }).setBackend(be); console.log(`# store → ${dbPath}`) }
  const g = getHellGraph()

  // parse every TTL into one triple set
  const triples = files.flatMap((f) => parseTurtle(fs.readFileSync(f, 'utf8')))

  // pass 1: rdf:type per subject (→ labels)
  const types = new Map<string, string[]>()
  for (const t of triples) if (t.p.value === RDF_TYPE && t.o.kind === 'iri') {
    ;(types.get(t.s.value) ?? types.set(t.s.value, []).get(t.s.value)!).push(local(t.o.value))
  }
  // pass 2: literal props + IRI edges
  const props = new Map<string, Record<string, string>>()
  const edges: { p: string; s: string; o: string }[] = []
  for (const t of triples) {
    if (t.p.value === RDF_TYPE) continue
    if (isLit(t.o)) {
      const p = props.get(t.s.value) ?? {}; const k = local(t.p.value)
      p[k] = p[k] ? `${p[k]}; ${t.o.value}`.slice(0, 500) : t.o.value.slice(0, 500); props.set(t.s.value, p)
    } else if (t.o.kind === 'iri') {
      edges.push({ p: local(t.p.value), s: t.s.value, o: t.o.value })
    }
  }

  // write nodes + edges (skip blank nodes)
  const subjects = new Set<string>([...types.keys(), ...props.keys(), ...edges.flatMap((e) => [e.s, e.o])].filter((s) => !s.startsWith('_:')))
  for (const s of subjects) g.addNode(s, ['EstateNode', ...(types.get(s) ?? [])], { tier: 'estate', scope: 'estate', local: local(s), ...(props.get(s) ?? {}) })
  let ne = 0
  for (const e of edges) { if (e.s.startsWith('_:') || e.o.startsWith('_:')) continue; g.addEdge(e.p, e.s, e.o, {}); ne++ }
  console.log(`# imported ${subjects.size} estate atoms · ${ne} edges from ${files.length} TTL(s)`)

  // BRIDGE: incident ConceptNode svc:<name>  ↔  estate component named <name>
  const estByName = new Map<string, string>()
  for (const s of subjects) estByName.set(local(s).toLowerCase(), s)
  let bridged = 0; const bridges: string[] = []
  for (const n of g.nodesByLabel('ConceptNode')) {
    const name = String(n.properties['symbol'] ?? '').split(':').pop()?.toLowerCase() ?? ''
    const est = name && estByName.get(name)
    if (est) { g.addEdge('REALIZES', n.id, est, {}); bridged++; if (bridges.length < 5) bridges.push(`${n.properties['symbol']} → ${local(est)}`) }
  }
  console.log(`# bridged ${bridged} incident symbol(s) ↔ estate component(s)${bridges.length ? ': ' + bridges.join(', ') : ''}`)

  // DERIVE dependency edges: sociosphere models contracts as prose that NAMES the other repo
  // ("Consumes tritrpc protocol spec…"), so turn that prose into a real, traversable DAG.
  const repos = g.nodesByLabel('Repository')
  const names = repos.map((r) => ({ id: r.id, name: String(r.properties['local'] ?? '').toLowerCase() }))
  // A repo name in the prose is only a dependency if the clause is POSITIVE — guard against
  // "None — must NOT depend on sociosphere", which a naive substring match wrongly reads as an edge.
  const NEG = /\b(no|not|none|never|cannot|independent|without|avoid)\b/i
  const POS = /\b(consum|use|depend|import|call|via|requir|read|pull|integrat|invoke)\b/i
  let derived = 0
  for (const r of repos) {
    const up = String(r.properties['upstreamContract'] ?? '')
    const down = String(r.properties['downstreamContract'] ?? '')
    for (const o of names) {
      if (o.id === r.id || !o.name) continue
      if (up.toLowerCase().includes(o.name) && POS.test(up) && !NEG.test(up)) { g.addEdge('dependsOn', r.id, o.id, { via: 'upstreamContract' }); derived++ }
      if (down.toLowerCase().includes(o.name) && POS.test(down) && !NEG.test(down)) { g.addEdge('feeds', r.id, o.id, { via: 'downstreamContract' }); derived++ }
    }
  }
  console.log(`# derived ${derived} dependency edge(s) from contract prose`)

  // PROBE: the estate is now a navigable graph — components carry their contracts + link by dependency
  console.log(`\n# estate now holds ${repos.length} Repository nodes:`)
  for (const r of repos.slice(0, 5)) {
    const role = g.out(r.id, 'role').map((n) => local(n.id))[0]
    const deps = g.out(r.id, 'dependsOn').map((n) => local(n.id))
    const up = String(r.properties['upstreamContract'] ?? '')
    console.log(`   ${String(r.properties['local']).padEnd(16)} role=${(role ?? '?').padEnd(16)} dependsOn=[${deps.join(', ') || '—'}]`)
    if (up) console.log(`       ↑ ${up.slice(0, 70)}${up.length > 70 ? '…' : ''}`)
  }
  console.log(`\n# walk: symptom → symbol → REALIZES → component → dependsOn → upstream component — one traversal.`)
}
main().catch((e) => { console.error(e); process.exit(1) })
