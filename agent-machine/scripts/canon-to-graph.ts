#!/usr/bin/env -S node --import tsx
/**
 * canon-to-graph — ingest the canon (Domain → Topic → GlossaryTerm / Formula) into HellGraph's
 * PROPERTY GRAPH so it shows in the graph UI BY DEFAULT. graph-surface.ts already roots the
 * `domain`/`knowledge` lenses on these exact labels (Domain/Topic/GlossaryTerm) and colours them
 * `learning` — the data was just never ingested.
 *
 * Uses the HellGraphStore property-graph API — addNode(id, labels, properties) / addEdge(label,
 * from, to, properties) — NOT the AtomSpace metagraph, so labels + properties project to allNodes()
 * (which the surface reads). addNode is id-keyed → idempotent on re-run.
 *
 * THE KEY MOVE: every node carries its KEYED-VEC CLASS — `kvClass` = the topic's nearest MMLU/MMLU-Pro
 * subject (+ `kvCos`), from canon/keyvec-alignment.json. That keyed-vec label is the DEFAULT class for
 * grouping/linking content, so the graph's topical structure IS the same eval-anchored decomposition as
 * the canon and the board. Terms + formulas inherit their topic's kvClass; a `close_match` edge Topic →
 * TestSubject carries the cosine (the eval anchor, visible in the graph).
 *
 * Run in the agent-machine env so it writes the same store the server/UI reads:
 *   node --import tsx scripts/canon-to-graph.ts
 */
import { getHellGraph } from '@socioprophet/hellgraph'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CANON = join(dirname(dirname(fileURLToPath(import.meta.url))), 'canon')
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

// (domain, topic) -> nearest keyed-vec test-subject + cosine  (the kvClass source)
const align = JSON.parse(readFileSync(join(CANON, 'keyvec-alignment.json'), 'utf8'))
const kv = new Map<string, { cls: string; cos: number }>()
for (const r of align.alignment ?? []) {
  const m = (r.matches ?? [])[0]
  if (m) kv.set(`${r.domain}::${r.topic}`, { cls: m.subject, cos: m.cos })
}

const g = getHellGraph()
let nD = 0, nT = 0, nG = 0, nF = 0, nE = 0
const subjSeen = new Set<string>(), termSeen = new Set<string>(), fmSeen = new Set<string>()

for (const f of readdirSync(CANON).filter((x) => x.startsWith('spec-') && x.endsWith('.json'))) {
  const spec = JSON.parse(readFileSync(join(CANON, f), 'utf8'))
  const domain: string = spec.domain ?? f.slice(5, -5)
  const domId = `canon:domain:${slug(domain)}`
  g.addNode(domId, ['Domain'], { name: domain, mmlu_pro: spec.mmlu_pro_category ?? '' }); nD++

  for (const t of spec.topics ?? []) {
    if (!t.topic) continue
    const topId = `canon:topic:${slug(domain)}:${slug(t.topic)}`
    const k = kv.get(`${domain}::${t.topic}`)
    const tp: Record<string, string | number> = { name: t.topic }
    if (t.level) tp.level = String(t.level)
    if (k) { tp.kvClass = k.cls; tp.kvCos = k.cos }     // ← the keyed-vec DEFAULT linking class
    g.addNode(topId, ['Topic'], tp); nT++
    g.addEdge('has_topic', domId, topId); nE++

    if (k) {
      const subjId = `canon:subject:${slug(k.cls)}`
      if (!subjSeen.has(subjId)) { g.addNode(subjId, ['TestSubject'], { name: k.cls }); subjSeen.add(subjId) }
      g.addEdge('close_match', topId, subjId, { cos: k.cos }); nE++
    }
    for (const gl of t.glossary ?? []) {
      if (!gl.term) continue
      const termId = `canon:term:${slug(domain)}:${slug(gl.term)}`
      if (!termSeen.has(termId)) {
        const p: Record<string, string> = { name: gl.term }
        if (gl.definition) p.definition = String(gl.definition).slice(0, 500)
        if (k) p.kvClass = k.cls
        g.addNode(termId, ['GlossaryTerm'], p); termSeen.add(termId); nG++
      }
      g.addEdge('has_term', topId, termId); nE++
    }
    for (const c of t.canon ?? []) {
      if (!c.name) continue
      const fmId = `canon:formula:${slug(domain)}:${slug(c.name)}`
      if (!fmSeen.has(fmId)) {
        const p: Record<string, string> = { name: c.name }
        if (c.form) p.form = String(c.form).slice(0, 300)
        if (c.type) p.ftype = String(c.type)
        if (k) p.kvClass = k.cls
        g.addNode(fmId, ['Formula'], p); fmSeen.add(fmId); nF++
      }
      g.addEdge('has_formula', topId, fmId); nE++
    }
  }
}

// cross-domain sense-aware links (tree → graph): related/same_as edges between concepts near in the
// sense-disambiguated concept space (canon-graph-links.py). Guarded by node existence so a stale link
// can't dangle. This is where the keyed-vec/sense alignment becomes traversable graph structure.
let nX = 0
try {
  const xl = JSON.parse(readFileSync(join(CANON, 'cross-domain-links.json'), 'utf8'))
  for (const l of xl.links ?? []) {
    if (g.getNode(l.from_id) && g.getNode(l.to_id)) {
      g.addEdge(l.rel, l.from_id, l.to_id, { cos: l.cos, crossdomain: true }); nX++; nE++
    }
  }
} catch { /* cross-domain-links.json not generated yet — run canon-graph-links.py first */ }

// prerequisite DAG (induce-prereq-dag.py, #3): REQUIRES edges between Topic nodes — the walkable learning
// order the registrar + tutor traverse. Edge A→B = "A requires B" (B must be learned first).
let nR = 0
try {
  const pd = JSON.parse(readFileSync(join(CANON, 'prereq-dag.json'), 'utf8')) as Record<string, { edges?: [string, string][] }>
  for (const [domain, v] of Object.entries(pd)) {
    for (const [a, b] of v.edges ?? []) {
      const aId = `canon:topic:${slug(domain)}:${slug(a)}`, bId = `canon:topic:${slug(domain)}:${slug(b)}`
      if (g.getNode(aId) && g.getNode(bId)) { g.addEdge('requires', aId, bId, { prereq: true }); nR++; nE++ }
    }
  }
} catch { /* prereq-dag.json not generated yet — run induce-prereq-dag.py */ }

// cross-domain structural analogies (induce-analogies.py, #4): ANALOGOUS_TO edges between Formula nodes,
// carrying the shared schema + variable mapping. This is a transfer bridge — same relation, different domain.
let nA = 0
try {
  const an = JSON.parse(readFileSync(join(CANON, 'analogies.json'), 'utf8')) as { analogies?: Array<{ a: string; a_domain: string; b: string; b_domain: string; schema?: string; mapping?: string }> }
  for (const a of an.analogies ?? []) {
    const aId = `canon:formula:${slug(a.a_domain)}:${slug(a.a)}`, bId = `canon:formula:${slug(a.b_domain)}:${slug(a.b)}`
    if (g.getNode(aId) && g.getNode(bId)) {
      g.addEdge('analogous_to', aId, bId, { schema: String(a.schema ?? '').slice(0, 200), mapping: String(a.mapping ?? '').slice(0, 200), crossdomain: true }); nA++; nE++
    }
  }
} catch { /* analogies.json not generated yet — run induce-analogies.py */ }

// lexical-closure IS-A hierarchy (lexical-closure.py, #DEDUCED): compositional-hyponymy edges between
// GlossaryTerm nodes — the cross-topic connective tissue (angular momentum →is_a→ momentum). Rule-derived,
// so the edge carries epistemicMode 'deduced'. Guarded by node existence.
let nI = 0
try {
  const lx = JSON.parse(readFileSync(join(CANON, 'lexical-hierarchy.json'), 'utf8')) as { edges?: Array<{ child: string; parent: string; child_topic: string; parent_topic: string }> }
  for (const e of lx.edges ?? []) {
    const cd = (e.child_topic || '').split(':')[0] || '', pd = (e.parent_topic || '').split(':')[0] || ''
    const cId = `canon:term:${slug(cd)}:${slug(e.child)}`, pId = `canon:term:${slug(pd)}:${slug(e.parent)}`
    if (g.getNode(cId) && g.getNode(pId)) { g.addEdge('is_a', cId, pId, { epistemicMode: 'deduced', rule: 'lexical-closure' }); nI++; nE++ }
  }
} catch { /* lexical-hierarchy.json not generated yet — run lexical-closure.py */ }

console.log(`# canon-to-graph → HellGraph property graph`)
console.log(`  ${nD} Domain · ${nT} Topic · ${nG} GlossaryTerm · ${nF} Formula · ${subjSeen.size} TestSubject · ${nE} edges (${nX} cross-domain · ${nR} requires · ${nA} analogous_to · ${nI} is_a)`)
console.log(`  kvClass (keyed-vec nearest test-subject) set as the default linking class on every node`)
console.log(`  store now: ${g.nodeCount()} nodes / ${g.edgeCount()} edges`)
console.log(`  → renders in the graph UI 'domain' + 'knowledge' lenses by default`)
