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
let ISA: Map<string, string> | null = null               // norm(child) → parent genus (lexical-closure IS-A, DEDUCED)
let EQNAMES: Map<string, { domain: string; topic: string; name: string }> | null = null   // equation/card names as entities

function load(): void {
  DEFS = new Map(); BRIDGES = new Map(); TOPICS = new Map(); PREREQ = new Map(); ISA = new Map(); EQNAMES = new Map()
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
          if (g.term && g.definition) {
            const def = { def: String(g.definition), domain, topic: t.topic }
            const k = norm(g.term)
            if (!DEFS!.has(k)) DEFS!.set(k, def)
            // Strip parenthetical abbreviations and trailing symbols so "molarity (M)" → "molarity",
            // "K_a" → "ka", "pH" → "ph" — multi-word normalized keys would never match single-word questions.
            const kBase = norm(g.term.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[.*?\]/g, '').trim())
            if (kBase && kBase !== k && !DEFS!.has(kBase)) DEFS!.set(kBase, def)
          }
        }
      }
    }
  } catch { /* specs absent */ }
  // enrich topic equations with the cards deck (seq2seq-mined formulas written back, attribute-equivalence
  // deduped by seq2seq-to-cards.py) — so the mined equations ground answers via canonGround, not just the
  // hand-authored canon[]. Deduped here too by normalized form so a card already in canon[] isn't doubled.
  try {
    for (const line of readFileSync(join(CANON, 'cards.jsonl'), 'utf8').split('\n')) {
      if (!line.trim()) continue
      const c = JSON.parse(line) as { front: string; back: string; domain: string; topic: string }
      const e = TOPICS!.get(tkey(c.domain, c.topic))
      if (e && !e.eqs.some((x) => x.form.replace(/\s+/g, '') === c.back.replace(/\s+/g, ''))) {
        e.eqs.push({ name: c.front.split(':')[0]!.trim(), form: c.back })
      }
    }
  } catch { /* cards deck absent */ }
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
  // lexical-closure IS-A (lexical-closure.py): the DEDUCED genus chains. The embedding manifold is continuous
  // (kmeans silhouette <0.1 — clusters blend), so clean set membership lives in this DISCRETE hierarchy, not
  // in vector clusters. norm(child) → parent genus; canonInFamily walks it for O(depth) inclusion/exclusion.
  try {
    for (const e of (JSON.parse(readFileSync(join(CANON, 'lexical-hierarchy.json'), 'utf8')).edges ?? []) as Array<{ child: string; parent: string }>) {
      ISA!.set(norm(e.child), e.parent)
    }
  } catch { /* lexical hierarchy absent */ }
  // equation/card NAMES are matchable entities too (e.g. "kinetic energy" is an equation name, not a glossary
  // term) — so canonEntities/canonRoute resolve them to their topic + equations. Built after the cards merge.
  for (const [, e] of TOPICS!) for (const eq of e.eqs) { const k = norm(eq.name); if (k && !EQNAMES!.has(k)) EQNAMES!.set(k, { domain: e.domain, topic: e.topic, name: eq.name }) }
}

/** Genus chain of a term via the lexical-closure IS-A hierarchy (deduced). [] if it's not a compound term. */
export function canonAncestors(term: string): string[] {
  if (!ISA) load()
  const out: string[] = []; let cur = norm(term); const seen = new Set<string>()
  while (ISA!.has(cur) && !seen.has(cur)) { seen.add(cur); const p = ISA!.get(cur)!; out.push(p); cur = norm(p) }
  return out
}

/** Set inclusion: is `term` in the `genus` family (genus an ancestor of term)? Discrete + deduced, O(depth).
 *  At canon scale this is exact; at corpus scale swap for a per-genus Bloom filter (same membership semantics). */
export function canonInFamily(term: string, genus: string): boolean {
  return canonAncestors(term).some((a) => norm(a) === norm(genus))
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

// Expand standard math notation to canonical English so S_5, Z_11, D_4 etc. match canon terms.
// Without this, questions using group/ring notation return zero entities (nothing to ground on).
function expandNotation(text: string): string {
  return text
    .replace(/\bS_?(\d+)\b/g, 'symmetric group S_$1')        // S_5 → symmetric group
    .replace(/\bA_?(\d+)\b/g, 'alternating group A_$1')       // A_4 → alternating group
    .replace(/\bD_?(\d+)\b/g, 'dihedral group D_$1')          // D_6 → dihedral group
    .replace(/\bZ_(\d+)\b/g, 'cyclic group Z_$1')             // Z_11 → cyclic group
    .replace(/\bGF\((\d+)\)/g, 'finite field GF($1)')          // GF(11) → finite field
    .replace(/\bF_(\d+)\b/g, 'finite field F_$1')             // F_p → finite field
    .replace(/\bGL_?\((\d+)\)/g, 'general linear group GL($1)') // GL(n) → general linear group
    .replace(/\bSL_?\((\d+)\)/g, 'special linear group SL($1)') // SL(n) → special linear group
    .replace(/\bZ\/(\d+)Z\b/g, 'integers modulo $1')          // Z/nZ → integers modulo n
}

/** The canon glossary terms that appear in `text` (the entities to ground), longest/most-specific first. */
export function canonEntities(text: string, max = 8): CanonEntity[] {
  if (!DEFS) load()
  const padded = ` ${norm(expandNotation(text))} `
  const words = new Set(padded.trim().split(' '))
  // Plural/suffix matching for single-word terms: "group" matches "groups", "ring" matches "rings",
  // "subgroup" matches "subgroups". Without this, MMLU questions consistently use plurals while the
  // canon stores singular forms — causing silent ungrounded routing for well-covered topics.
  const wordMatchesTerm = (k: string): boolean => {
    if (words.has(k)) return true
    for (const suffix of ['s', 'es', 'ies']) {
      if (words.has(k + suffix)) return true
      if (suffix === 'ies' && k.endsWith('y') && words.has(k.slice(0, -1) + 'ies')) return true
    }
    return false
  }
  const presentMulti = (k: string): boolean =>
    padded.includes(` ${k} `) || padded.includes(` ${k}s `) || padded.includes(` ${k}es `) ||
    (k.endsWith('y') && padded.includes(` ${k.slice(0, -1)}ies `))
  const present = (k: string): boolean => k.includes(' ') ? presentMulti(k) : (k.length >= 4 && wordMatchesTerm(k))
  const hits: CanonEntity[] = []
  const seen = new Set<string>()
  for (const [k, d] of DEFS!) {
    if (present(k)) { hits.push({ term: k, def: d.def, domain: d.domain, topic: d.topic, tkey: tkey(d.domain, d.topic) }); seen.add(k) }
  }
  for (const [k, e] of EQNAMES!) {                     // equation/card names are entities too (e.g. "kinetic energy")
    if (!seen.has(k) && present(k)) { hits.push({ term: e.name, def: '', domain: e.domain, topic: e.topic, tkey: tkey(e.domain, e.topic) }); seen.add(k) }
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
