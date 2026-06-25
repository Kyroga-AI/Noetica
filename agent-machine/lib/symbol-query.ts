// symbol-query — the "what we search for" lever, HippoRAG-style. The literal question text is the wrong query;
// the right query is the SYMBOLS the question is about (the canon entities = glossary terms + equation/operator
// names) plus their GRAPH neighborhood (genus/is-a from lexical-hierarchy), used as retrieval SEEDS — exactly
// HippoRAG's "extract key concepts → run PPR on the KG seeded by them." This turns retrieval from string-match
// into symbol-grounded concept retrieval. Returns the expanded query set + the canon grounding to inject.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { canonRoute } from './canon-route.js'
import { canonAncestors, canonBridges } from './canon-lookup.js'

const CANON = process.env['CANON_DIR'] || join(__dirname, '..', 'canon')
// symbol → KBpedia RC + Wikidata ID (built by the phase-3 grounding; gives symbols CANONICAL identity so the
// graph we assemble is KBpedia's 32M-node graph, not just our local canon). Loaded once, best-effort.
interface Grounded { kbpedia_rc: string | null; wikidata: string | null; rc_name?: string | null; confidence?: string; domain?: string }
let _grounding: Record<string, Grounded> | null | undefined
function grounding(): Record<string, Grounded> {
  if (_grounding !== undefined) return _grounding ?? {}
  try {
    const p = join(CANON, 'symbol-grounding.json')
    _grounding = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, Grounded>) : null
  } catch { _grounding = null }
  return _grounding ?? {}
}

// symbol → CSKG commonsense edges (IsA/PartOf/Causes/UsedFor/…), joined via Wikidata Q-id. These are the
// DENSE graph edges HippoRAG-style PPR needs — far richer than our lexical genus alone. Built by the CSKG bridge.
interface CSEdge { rel: string; neighbor_label?: string; target_label?: string; src_label?: string }
let _cs: Record<string, { commonsense_edges: CSEdge[] }> | null | undefined
function commonsense(): Record<string, { commonsense_edges: CSEdge[] }> {
  if (_cs !== undefined) return _cs ?? {}
  try {
    const p = join(CANON, 'symbol-commonsense.json')
    _cs = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
  } catch { _cs = null }
  return _cs ?? {}
}

export interface SymbolQuery {
  symbols: string[]                 // the canon entities (glossary terms + operator names) found in the question
  grounded: Array<{ symbol: string; kbpedia_rc: string | null; wikidata: string | null; confidence: string }>  // canonical identity (KBpedia/Wikidata) + sense confidence
  commonsenseEdges: Array<{ symbol: string; rel: string; neighbor: string }>         // CSKG edges expanding the graph
  seeds: string[]                   // the expanded retrieval seeds: symbols + their genus + bridges (the PPR seeds)
  queries: string[]                 // ready-to-embed query strings (symbol-grounded, not literal text)
  grounding: string                 // canon defs + equations + is-a chain to inject alongside retrieved chunks
}

/**
 * Build a symbol-grounded query from a question: extract the canon symbols, walk the graph one hop (genus +
 * cross-domain bridges) for the PPR-style seed set, and emit queries seeded on the SYMBOLS rather than the
 * literal sentence. `extraHops` pulls bridges too (the cross-domain links — Think-on-Graph style).
 */
export function symbolQuery(question: string, extraHops = true): SymbolQuery {
  const route = canonRoute(question)
  const symbols = route.entities
  // attach canonical KBpedia/Wikidata identity where a symbol is grounded (phase-3 entity grounding)
  const gmap = grounding()
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const gByNorm = new Map(Object.entries(gmap).map(([k, v]) => [norm(k), v]))
  const grounded = symbols
    .map((s) => ({ symbol: s, g: gmap[s] ?? gByNorm.get(norm(s)) }))
    .filter((x): x is { symbol: string; g: Grounded } => !!x.g)
    .map((x) => ({ symbol: x.symbol, kbpedia_rc: x.g.kbpedia_rc, wikidata: x.g.wikidata, confidence: x.g.confidence ?? 'unknown' }))
  const seedSet = new Set<string>(symbols)
  const cs = commonsense()
  const commonsenseEdges: Array<{ symbol: string; rel: string; neighbor: string }> = []
  for (const s of symbols) {
    for (const g of canonAncestors(s)) seedSet.add(g)               // genus / is-a (lexical-hierarchy graph)
    if (extraHops) for (const b of canonBridges(s)) seedSet.add(b)  // cross-domain bridges (the KG edges)
    const ce = (cs[s] ?? cs[Object.keys(cs).find((k) => norm(k) === norm(s)) ?? ''])?.commonsense_edges ?? []
    for (const e of ce.slice(0, 10)) {                              // CSKG commonsense edges (the dense PPR graph)
      const neighbor = e.neighbor_label ?? e.target_label ?? e.src_label   // tolerate both edge formats
      if (neighbor) { seedSet.add(neighbor); commonsenseEdges.push({ symbol: s, rel: e.rel, neighbor }) }
    }
  }
  const seeds = [...seedSet]
  // queries: each symbol grounded with its genus context (concept-as-seed), + one combined symbol query.
  const queries = symbols.length
    ? [...symbols.map((s) => `${s} ${canonAncestors(s).slice(0, 2).join(' ')}`.trim()),
       seeds.slice(0, 8).join(' ')]
    : [question]                                                     // no canon symbols → fall back to literal
  return { symbols, grounded, commonsenseEdges, seeds, queries: [...new Set(queries)].filter(Boolean), grounding: route.grounding }
}

// CLI self-test:  npx tsx lib/symbol-query.ts "Calculate the angular momentum of a wheel"
if (process.argv[1] && process.argv[1].endsWith('symbol-query.ts')) {
  for (const q of [
    process.argv.slice(2).join(' ') || 'How does an antigen relate to dark matter and a vector space',
    'What is the molarity of a solution',
  ]) {
    const r = symbolQuery(q)
    console.log(`\nQ: ${q.slice(0, 56)}`)
    console.log(`  symbols: [${r.symbols.join(', ')}]`)
    console.log(`  GROUNDED: ${r.grounded.map((g) => `${g.symbol}→${g.wikidata ?? g.kbpedia_rc?.split('/').pop() ?? '?'}(${g.confidence})`).join('  ') || '(none)'}`)
    console.log(`  CSKG edges: ${r.commonsenseEdges.map((e) => `${e.symbol} ${e.rel} ${e.neighbor}`).slice(0, 5).join('  ·  ') || '(none)'}`)
    console.log(`  seeds(${r.seeds.length}): [${r.seeds.slice(0, 10).join(', ')}]`)
  }
}
