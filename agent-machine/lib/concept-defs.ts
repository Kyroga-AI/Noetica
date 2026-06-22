/**
 * concept-defs — the CLEAN, STRUCTURED concept layer the OCW lecture-transcript brain lacks.
 *
 * Verified finding: the OCW brain is lecture transcripts — great as generation context, but it
 * has NO clean definitions (extracting "central limit theorem" yields a garbage formula fragment),
 * and the GLiNER/KeyBERT glossary is a noisy pile (its top "terms" include http/mathjax/they).
 * Fix: link our canonical glossary terms to external KGs (Wikipedia/DBpedia — crisp first-paragraph
 * definitions), fetched OFFLINE and cached LOCALLY (local-first), keyed by term. This powers:
 *   1. a clean "what is X" LOOKUP (no generation — the lookup-vs-generative UX win), and
 *   2. a structured concept layer for the HellGraph (term → definition + source, not a flat pile).
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const STORE = path.join(os.homedir(), '.noetica', 'concepts')

// GLiNER/KeyBERT extraction leaks HTML chrome + stopwords as "top terms" — filter them out so we
// only enrich REAL concepts (the cleanup the brain needs).
const JUNK = new Set([
  'http', 'https', 'www', 'html', 'mathjax', 'span', 'div', 'href', 'png', 'jpg', 'pdf', 'doc',
  'they', 'this', 'that', 'with', 'from', 'have', 'will', 'your', 'about', 'which', 'what', 'when',
  'where', 'their', 'there', 'then', 'them', 'first', 'also', 'more', 'than', 'into', 'some', 'such',
  'each', 'these', 'those', 'other', 'using', 'used', 'use', 'one', 'two', 'can', 'are', 'the',
])

export interface Concept { term: string; definition: string; url: string; source: string; field?: string }

// Course boilerplate the GLiNER/KeyBERT extraction captured as "terms" — never concepts.
const BOILER = new Set([
  'page', 'fall', 'spring', 'summer', 'winter', 'ocw', 'mit', 'course', 'lecture', 'problem', 'set',
  'exam', 'solution', 'assignment', 'chapter', 'section', 'figure', 'table', 'copyright', 'notes',
  'homework', 'quiz', 'midterm', 'final', 'syllabus', 'reading', 'slide', 'handout', 'professor',
])

/** Keep only real 1-2 word alphabetic concept terms (drops digits/boilerplate/stopwords/chrome). */
export function cleanTerm(t: string): string | null {
  const s = t.trim().toLowerCase()
  if (s.length < 3 || s.length > 30) return null
  if (/\d/.test(s)) return null                          // years / page-numbers / course codes
  if (!/^[a-z][a-z -]*[a-z]$/.test(s)) return null        // alpha words only
  const words = s.split(/[ -]+/)
  if (words.length > 2) return null                       // concepts are 1-2 words; longer = boilerplate
  if (words.some((w) => JUNK.has(w) || BOILER.has(w))) return null
  return s
}

// Field → Wikipedia disambiguation qualifier (so "cell" → "Cell (biology)" not the disambig page).
const FIELD_QUALIFIER: Record<string, string> = {
  biology: 'biology', biological_eng: 'biology', chemistry: 'chemistry', physics: 'physics',
  mathematics: 'mathematics', eecs: 'computer science', earth_planetary: 'geology',
}

// Domain-relevance keywords: a concept is kept only if its DEFINITION mentions one — this self-cleans
// the generic words (time, three, information) that leak past the term filter because the glossary is
// frequency-ranked, not concept-ranked. The honest fix for "the brain is a noisy pile".
const FIELD_KEYWORDS: Record<string, RegExp> = {
  biology: /\b(biolog|cell|organism|gene|genetic|species|molecul|protein|dna|rna|enzyme|evolution|tissue|bacteri|virus|metabol|chromosom)/i,
  biological_eng: /\b(biolog|cell|molecul|protein|gene|enzyme|tissue|bioengineer|metabol)/i,
  chemistry: /\b(chemi|molecul|atom|reaction|compound|element|chemical bond|acid|\bion\b|electron|oxid|solvent|reagent)/i,
  physics: /\b(physic|energy|force|particle|quantum|wave|motion|momentum|mass|electromagnet|thermodynam|relativ|velocit|gravit)/i,
  mathematics: /\b(mathematic|theorem|equation|function|\bset\b|algebra|geometr|probabilit|vector|matrix|integral|derivative|topolog|polynomial|calculus)/i,
  eecs: /\b(comput|algorithm|software|circuit|electr|\bdata\b|program|network|signal|processor|memory|transistor|binary|logic gate)/i,
  earth_planetary: /\b(geolog|earth|planet|rock|mineral|atmospher|ocean|climate|seismic|tecton|volcan|sediment)/i,
}

async function tryTitle(title: string, term: string): Promise<Concept | null> {
  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
      signal: AbortSignal.timeout(8000),
      headers: { accept: 'application/json', 'user-agent': 'Noetica-concept-enrich/1.0 (educational)' },
    })
    if (!res.ok) return null
    const j = (await res.json()) as { extract?: string; type?: string; content_urls?: { desktop?: { page?: string } } }
    if (j.type === 'disambiguation' || !j.extract || j.extract.length < 40) return null
    return { term, definition: j.extract, url: j.content_urls?.desktop?.page ?? '', source: 'wikipedia' }
  } catch { return null }
}

/** Fetch a crisp definition from Wikipedia (the clean knowledge OCW transcripts lack). When the
 *  bare term is a disambiguation page, retry field-qualified (e.g. "Cell (biology)"). */
export async function fetchConceptDef(term: string, field?: string): Promise<Concept | null> {
  const t = term.trim()
  const base = t.replace(/\s+/g, '_')
  let c = await tryTitle(base, t)
  if ((!c || (field && FIELD_KEYWORDS[field] && !FIELD_KEYWORDS[field]!.test(c.definition))) && field && FIELD_QUALIFIER[field]) {
    // disambiguation OR off-domain article (e.g. "Cell" → spreadsheet) → retry field-qualified
    const q = await tryTitle(`${base}_(${FIELD_QUALIFIER[field].replace(/\s+/g, '_')})`, t)
    if (q) c = q
  }
  // Domain-relevance gate: drop generic words whose definition isn't about the field.
  if (c && field && FIELD_KEYWORDS[field] && !FIELD_KEYWORDS[field]!.test(c.definition)) return null
  return c
}

function storeFile(field: string): string { return path.join(STORE, `${field}.concepts.json`) }

export function loadConcepts(field: string): Record<string, Concept> {
  try { return JSON.parse(fs.readFileSync(storeFile(field), 'utf8')) as Record<string, Concept> } catch { return {} }
}
function saveConcepts(field: string, c: Record<string, Concept>): void {
  fs.mkdirSync(STORE, { recursive: true })
  fs.writeFileSync(storeFile(field), JSON.stringify(c))
}

export function conceptStoreFields(): string[] {
  try { return fs.readdirSync(STORE).filter((f) => f.endsWith('.concepts.json')).map((f) => f.replace('.concepts.json', '')) } catch { return [] }
}

/**
 * Lookup the clean definition for a "what is X / define X / explain X" query — local, instant,
 * grounded (verbatim from Wikipedia, cannot hallucinate). Returns null if X isn't an enriched
 * concept, so the caller falls through to retrieval+generation unchanged.
 */
export function conceptLookup(query: string, fields: string[] = []): Concept | null {
  const m = /(?:what (?:is|are|s)|what'?s|define|explain|tell me about|describe)\s+(?:an?\s+|the\s+)?(.+?)\s*[?.!]*$/i.exec(query.trim())
  const term = (m?.[1] ?? '').toLowerCase().trim()
  if (!term || term.length < 3) return null
  for (const f of (fields.length ? fields : conceptStoreFields())) {
    const c = loadConcepts(f)
    if (c[term]) return c[term]
  }
  return null
}

// CLI:  npx tsx lib/concept-defs.ts <field> [glossaryPath]   (CONCEPT_TOP=N caps terms)
if (process.argv[1] && process.argv[1].endsWith('concept-defs.ts')) {
  const field = process.argv[2] || 'biology'
  const gpath = process.argv[3] || path.join(os.homedir(), 'Downloads', 'MIT OCW', '_brain', `${field}.glossary.json`)
  const top = Number(process.env['CONCEPT_TOP'] || 60)
  ;(async () => {
    const g = JSON.parse(fs.readFileSync(gpath, 'utf8')) as { domain_top?: Array<{ term: string; count: number }> }
    const terms = [...new Set((g.domain_top ?? []).map((x) => cleanTerm(x.term)).filter((x): x is string => !!x))].slice(0, top)
    console.log(`# enrich ${field}: ${terms.length} clean terms (filtered from ${g.domain_top?.length ?? 0})`)
    const store = loadConcepts(field)
    let got = 0
    for (const t of terms) {
      if (store[t]) { got++; continue }
      const c = await fetchConceptDef(t, field)
      if (c) { store[t] = { ...c, field }; got++; process.stdout.write(`  ✓ ${t}: ${c.definition.slice(0, 64).replace(/\s+/g, ' ')}…\n`) }
      else process.stdout.write(`  ✗ ${t}\n`)
      await new Promise((r) => setTimeout(r, 200)) // be polite to Wikipedia
    }
    saveConcepts(field, store)
    console.log(`# saved ${got}/${terms.length} concepts → ${storeFile(field)}`)
  })()
}
