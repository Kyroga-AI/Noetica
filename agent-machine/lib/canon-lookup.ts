/**
 * canon-lookup — file-based reader of the canon glossary + sense-aware cross-domain links, for the board's
 * defs/hop arms. FILE-BASED (reads canon/*.json) so it's portable to the board VM — no live graph DB needed;
 * same canon data the graph UI ingests, a different consumer.
 *
 *   canonDef(term)     → the CLEAN authored definition the lecture-transcript brain lacks (concept-defs.ts's
 *                        cleanest, first source — beats a Wikipedia paragraph for our exact terms).
 *   canonBridges(term) → the sense-disambiguated cross-domain bridge concepts (canon-graph-links.py) — the
 *                        curated multi-hop edges for the HippoRAG `hop` arm to traverse.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// __dirname (lib/) + env override — CJS-safe and tsx-safe, matching the notecard loader convention.
const CANON = process.env['CANON_DIR'] || join(__dirname, '..', 'canon')
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

let DEFS: Map<string, { def: string; domain: string }> | null = null
let BRIDGES: Map<string, string[]> | null = null

function load(): void {
  DEFS = new Map(); BRIDGES = new Map()
  // glossary definitions from the domain specs (first writer wins — stable across runs)
  try {
    for (const f of readdirSync(CANON).filter((x) => x.startsWith('spec-') && x.endsWith('.json'))) {
      const spec = JSON.parse(readFileSync(join(CANON, f), 'utf8'))
      const domain: string = spec.domain ?? f.slice(5, -5)
      for (const t of spec.topics ?? []) for (const g of t.glossary ?? []) {
        if (g.term && g.definition) { const k = norm(g.term); if (!DEFS!.has(k)) DEFS!.set(k, { def: String(g.definition), domain }) }
      }
    }
  } catch { /* specs absent */ }
  // sense-aware cross-domain bridges (canon/cross-domain-links.json: from/to are "domain:label")
  try {
    const xl = JSON.parse(readFileSync(join(CANON, 'cross-domain-links.json'), 'utf8'))
    const lbl = (s: string): string => s.split(':').slice(1).join(':').trim() || s
    const push = (k: string, v: string): void => { const a = BRIDGES!.get(k); if (a) { if (!a.includes(v)) a.push(v) } else BRIDGES!.set(k, [v]) }
    for (const l of xl.links ?? []) { const a = lbl(l.from), b = lbl(l.to); push(norm(a), b); push(norm(b), a) }
  } catch { /* links absent */ }
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

export function canonStats(): { defs: number; bridged: number } {
  if (!DEFS) load()
  return { defs: DEFS!.size, bridged: BRIDGES!.size }
}
