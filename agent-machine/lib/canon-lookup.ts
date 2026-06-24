/**
 * canon-lookup — file-based reader of the canon (glossary + equations + cross-domain links + prereq DAG), for
 * the board's defs/hop/ground arms and the product. FILE-BASED (reads canon/*.json) so it's portable to the
 * board VM — no live graph DB needed; same canon the graph UI ingests, a different consumer.
 *
 *   canonDef(term)       → the CLEAN authored definition the lecture-transcript brain lacks.
 *   canonBridges(term)   → sense-disambiguated cross-domain bridge concepts (canon-graph-links.py).
 *   canonEntities(text)  → the canon glossary terms that appear in a question (the entities to ground).
 *   canonFormulas(d,t)   → the canonical equations/models for a topic (the 766 canon[] entries).
 *   canonPrereqs(d,t)    → the prerequisite topics of a topic (prereq-dag.json) — the decomposition.
 *   canonGround(text)    → ASSEMBLE all of the above for a question into one grounding block: definitions +
 *                          related equations/models + what it builds on (prereqs) + related concepts. This is
 *                          how the static canon (1035 terms, 766 equations, 121 prereq edges) actually does
 *                          work at answer time instead of sitting in the graph.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const CANON = process.env['CANON_DIR'] || join(__dirname, '..', 'canon')
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const tkey = (domain: string, topic: string): string => `${norm(domain)}::${norm(topic)}`

interface DefEntry { def: string; domain: string; topic: string }
interface TopicEntry { domain: string; topic: string; level: string; eqs: Array<{ name: string; form: string }> }
export interface CanonEntity { term: string; def: string; domain: string; topic: string; tkey: string }

let DEFS: Map<string, DefEntry> | null = null
let BRIDGES: Map<string, string[]> | null = null
let TOPICS: Map<string, TopicEntry> | null = null        // "domain::topic" → {level, equations}
let PREREQ: Map<string, string[]> | null = null          // "domain::topic" → prerequisite topic names

function load(): void {
  DEFS = new Map(); BRIDGES = new Map(); TOPICS = new Map(); PREREQ = new Map()
  // specs: glossary definitions + canonical equations per topic
  try {
    for (const f of readdirSync(CANON).filter((x) => x.startsWith('spec-') && x.endsWith('.json'))) {
      const spec = JSON.parse(readFileSync(join(CANON, f), 'utf8'))
      const domain: string = spec.domain ?? f.slice(5, -5)
      for (const t of spec.topics ?? []) {
        if (!t.topic) continue
        const tk = tkey(domain, t.topic)
        const eqs = (t.canon ?? []).filter((c: { name?: string; form?: string }) => c.name && c.form)
          .map((c: { name: string; form: string }) => ({ name: c.name, form: c.form }))
        TOPICS!.set(tk, { domain, topic: t.topic, level: String(t.level ?? ''), eqs })
        for (const g of t.glossary ?? []) {
          if (g.term && g.definition) { const k = norm(g.term); if (!DEFS!.has(k)) DEFS!.set(k, { def: String(g.definition), domain, topic: t.topic }) }
        }
      }
    }
  } catch { /* specs absent */ }
  // sense-aware cross-domain bridges (cross-domain-links.json: from/to are "domain:label")
  try {
    const xl = JSON.parse(readFileSync(join(CANON, 'cross-domain-links.json'), 'utf8'))
    const lbl = (s: string): string => s.split(':').slice(1).join(':').trim() || s
    const push = (k: string, v: string): void => { const a = BRIDGES!.get(k); if (a) { if (!a.includes(v)) a.push(v) } else BRIDGES!.set(k, [v]) }
    for (const l of xl.links ?? []) { const a = lbl(l.from), b = lbl(l.to); push(norm(a), b); push(norm(b), a) }
  } catch { /* links absent */ }
  // prerequisite DAG (prereq-dag.json: {domain:{edges:[[A,B]]}} — [A,B] = "A requires B")
  try {
    const pd = JSON.parse(readFileSync(join(CANON, 'prereq-dag.json'), 'utf8')) as Record<string, { edges?: [string, string][] }>
    for (const [domain, v] of Object.entries(pd)) {
      for (const [a, b] of v.edges ?? []) {
        const k = tkey(domain, a); const arr = PREREQ!.get(k); if (arr) { if (!arr.includes(b)) arr.push(b) } else PREREQ!.set(k, [b])
      }
    }
  } catch { /* prereq-dag absent */ }
}

/** Clean authored definition for a term (the canon glossary), or null → caller falls through unchanged. */
export function canonDef(term: string): string | null {
  if (!DEFS) load()
  return DEFS!.get(norm(term))?.def ?? null
}

/** Sense-aware cross-domain bridge concepts for a term (curated related/same_as links). */
export function canonBridges(term: string): string[] {
  if (!BRIDGES) load()
  return BRIDGES!.get(norm(term)) ?? []
}

/** The canon glossary terms that appear in `text` (the entities to ground), longest/most-specific first. */
export function canonEntities(text: string, max = 8): CanonEntity[] {
  if (!DEFS) load()
  const padded = ` ${norm(text)} `
  const words = new Set(padded.trim().split(' '))
  const hits: CanonEntity[] = []
  for (const [k, d] of DEFS!) {
    const multi = k.includes(' ')
    const present = multi ? padded.includes(` ${k} `) : (k.length >= 4 && words.has(k))
    if (present) hits.push({ term: k, def: d.def, domain: d.domain, topic: d.topic, tkey: tkey(d.domain, d.topic) })
  }
  hits.sort((a, b) => b.term.length - a.term.length)   // prefer specific multi-word terms over short generics
  return hits.slice(0, max)
}

/** Canonical equations/models for a topic (the canon[] {name, form}). */
export function canonFormulas(domain: string, topic: string): Array<{ name: string; form: string }> {
  if (!TOPICS) load()
  return TOPICS!.get(tkey(domain, topic))?.eqs ?? []
}

/** Prerequisite topics of a topic (the decomposition — what it builds on). */
export function canonPrereqs(domain: string, topic: string): string[] {
  if (!PREREQ) load()
  return PREREQ!.get(tkey(domain, topic)) ?? []
}

/**
 * canonGround — assemble the canon grounding for a question: the definitions of its entities, the related
 * equations/models, the prerequisite topics it builds on, and related concepts. Returns '' when nothing in
 * the question matches the canon (safe to inject unconditionally). This is the answer-time use of the canon.
 */
export function canonGround(text: string, opts: { maxDefs?: number; maxEqs?: number; maxPrereq?: number } = {}): string {
  if (!DEFS) load()
  const ents = canonEntities(text, 10)
  if (!ents.length) return ''
  const defs = ents.slice(0, opts.maxDefs ?? 6)
  const topics = [...new Set(ents.map((e) => e.tkey))]
  const eqs: Array<{ name: string; form: string }> = []
  const prereqs = new Set<string>()
  const seenEq = new Set<string>()
  for (const e of ents) {
    for (const eq of canonFormulas(e.domain, e.topic)) { if (!seenEq.has(eq.name)) { seenEq.add(eq.name); eqs.push(eq) } }
    for (const p of canonPrereqs(e.domain, e.topic)) prereqs.add(p)
  }
  const bridges = new Set<string>()
  for (const e of defs) for (const b of canonBridges(e.term)) bridges.add(b)
  const out: string[] = ['Canon grounding (use what is relevant; ignore the rest):']
  if (defs.length) out.push('Definitions:\n' + defs.map((e) => `- ${e.term}: ${e.def.slice(0, 180)}`).join('\n'))
  if (eqs.length) out.push('Relevant equations/models:\n' + eqs.slice(0, opts.maxEqs ?? 6).map((e) => `- ${e.name}:  ${e.form}`).join('\n'))
  if (prereqs.size) out.push('Builds on (prerequisites): ' + [...prereqs].slice(0, opts.maxPrereq ?? 5).join(' · '))
  if (bridges.size) out.push('Related concepts: ' + [...bridges].slice(0, 6).join(', '))
  return topics.length ? out.join('\n\n') : ''
}

export function canonStats(): { defs: number; bridged: number; topics: number; prereq: number } {
  if (!DEFS) load()
  return { defs: DEFS!.size, bridged: BRIDGES!.size, topics: TOPICS!.size, prereq: PREREQ!.size }
}

// CLI self-test:  npx tsx lib/canon-lookup.ts "a torque problem about angular momentum"
if (process.argv[1] && process.argv[1].endsWith('canon-lookup.ts')) {
  const q = process.argv.slice(2).join(' ') || 'a block on an inclined plane with friction and angular momentum'
  console.log('stats:', canonStats())
  console.log(`\nentities in "${q}":`, canonEntities(q).map((e) => e.term))
  console.log('\n── canonGround ──\n' + (canonGround(q) || '(no canon match)'))
}
