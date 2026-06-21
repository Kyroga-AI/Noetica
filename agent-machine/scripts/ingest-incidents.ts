#!/usr/bin/env bun
/**
 * ingest-incidents — turn the incident JSONL into real atomspace knowledge.
 *
 * incident_capture.py captures/clusters/correlates and emits a graph JSON; this loads it into
 * HellGraph as proper atoms so a failure is findable TWO ways in the brain:
 *   • VECTOR  — each symptom is embedded (nomic-embed) onto a DocumentChunk → semanticSearch
 *               answers "have I seen this error before?" by meaning, not string match.
 *   • SYMBOL  — FailureAtom --MENTIONS--> ConceptNode(symbol), Incident --MEMBER_OF/RESOLVED_BY-->
 *               Skill, symbol --CORRELATES--> symbol. A graph walk goes symptom → incident → fix.
 * Same chunk/atom representation the OCW brain uses, so troubleshooting memory lives in the
 * one brain beside the academic knowledge — exactly the "make it findable" requirement.
 *
 * Usage:  bun scripts/ingest-incidents.ts <graph.json> [--probe "symptom"]
 *         INCIDENT_DB=<path.sqlite> to target a specific atomspace (default: an isolated demo db).
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { getAtomSpace, getHellGraph, putChunk, embedText, semanticSearch } from '@socioprophet/hellgraph'
import { createSQLiteBackend, migrateJSONLToSQLite } from '../lib/sqlite-backend.js'

const F = (id: string) => `urn:incident:failure:${id}`
const C = (s: string) => `urn:concept:${s}`

async function main() {
  const graphFile = process.argv[2]
  if (!graphFile || !fs.existsSync(graphFile)) { console.error('usage: ingest-incidents.ts <graph.json> [--probe "q"]'); process.exit(1) }
  const probeI = process.argv.indexOf('--probe')
  const probeQ = probeI >= 0 ? process.argv[probeI + 1] : 'connection refused to prometheusd on its port'

  // Bootstrap persistence the same way server.ts does (isolated demo db by default so a
  // demonstration never pollutes the primary brain; set INCIDENT_DB to write the real one).
  const dbPath = process.env['INCIDENT_DB'] || path.join(os.homedir(), '.noetica', 'hellgraph', 'incident-demo.sqlite')
  const space = getAtomSpace()
  const be = createSQLiteBackend(dbPath)
  if (be) { migrateJSONLToSQLite(be); space.setBackend(be); console.log(`# SQLite backend attached → ${dbPath} (${be.atomCount()} atoms)`) }
  else console.log('# no bun:sqlite — default WAL persistence (run under bun for SQLite)')

  const g = getHellGraph()
  const data = JSON.parse(fs.readFileSync(graphFile, 'utf8')) as {
    atoms: { id: string; symptom: string; symbols: string[]; severity: string; source: string; ts: number }[]
    incidents: { id: string; signature: string[]; window: { start: number; end: number }; member_ids: string[]; status: string; resolved_by: string | null; resolution_evidence: Record<string, unknown> }[]
    edges: { a: string; b: string; cooccur: number; lift: number }[]
  }

  // FailureAtoms + embedded symptom chunk (vector) + symbol concepts (symbol)
  let embedded = 0
  for (const a of data.atoms) {
    const id = F(a.id)
    g.addNode(id, ['FailureAtom', 'RECORD'], {
      symptom: a.symptom, severity: a.severity, source: a.source, ts: a.ts,
      symbols: JSON.stringify(a.symbols), tier: 'incident',
    })
    const vec = await embedText(a.symptom)
    if (vec.length) embedded++
    putChunk({ docId: id, idx: 0, text: a.symptom, vec,
      filename: `[incident/${a.source}] ${a.symbols.join(' ')}`,
      meta: { tier: 'incident', severity: a.severity } })
    for (const s of a.symbols) {
      g.addNode(C(s), ['ConceptNode'], { symbol: s })
      g.addEdge('MENTIONS', id, C(s), {})
    }
  }
  // Incidents + membership + tagged solution (the Skill)
  for (const inc of data.incidents) {
    const iid = `urn:incident:${inc.id}`
    g.addNode(iid, ['Incident'], { signature: JSON.stringify(inc.signature), status: inc.status,
      start: inc.window.start, end: inc.window.end })
    for (const m of inc.member_ids) g.addEdge('MEMBER_OF', F(m), iid, {})
    if (inc.resolved_by) {
      const sid = `urn:skill:${inc.resolved_by}`
      g.addNode(sid, ['Skill'], { name: inc.resolved_by })
      g.addEdge('RESOLVED_BY', iid, sid, inc.resolution_evidence as Record<string, string | number>)
    }
  }
  // Empirical failure-dependency edges between symbols
  for (const e of data.edges) g.addEdge('CORRELATES', C(e.a), C(e.b), { cooccur: e.cooccur, lift: e.lift })

  console.log(`# ingested ${data.atoms.length} FailureAtoms (${embedded} embedded) · ${data.incidents.length} incidents · ${data.edges.length} correlations`)
  console.log(`# atomspace now: ${g.nodeCount()} nodes / ${g.edgeCount()} edges\n`)

  // PROBE 1 — vector findability (meaning, not string match)
  console.log(`# probe ① VECTOR  "${probeQ}"`)
  const hits = await semanticSearch(probeQ, 3)
  for (const h of hits) console.log(`   [${h.score.toFixed(3)}] ${h.filename}  ::  ${h.text.replace(/\s+/g, ' ').slice(0, 72)}`)
  if (!hits.length) console.log('   (no vector hits)')

  // PROBE 2 — symbol findability → incident → tagged fix (the troubleshooting walk)
  console.log(`\n# probe ② SYMBOL  err:ECONNREFUSED → failures → incident → fix`)
  for (const f of g.in(C('err:ECONNREFUSED'), 'MENTIONS')) {
    const inc = g.out(f.id, 'MEMBER_OF')[0]
    const skill = inc ? g.out(inc.id, 'RESOLVED_BY')[0] : undefined
    console.log(`   ${f.id.split(':').pop()} → ${inc?.id.split(':').pop() ?? '(none)'} → ${skill?.properties['name'] ?? '(unresolved)'}`)
  }
  console.log('\n# the brain now answers "seen this before?" by meaning AND by symbol, and hands back the fix.')
}
main().catch((e) => { console.error(e); process.exit(1) })
