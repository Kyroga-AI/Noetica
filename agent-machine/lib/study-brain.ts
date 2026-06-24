/**
 * study-brain — REUSABLE OCW-brain retrieval for the DialogueFlow lanes.
 *
 * The MMLU reasoning stack (multishot retrieval over the MIT-OCW brain + the council) was trapped
 * inside the mmlu-brain-bench.ts MONOLITH (0 exports) — a benchmark, never wired into the product.
 * The dialogue flow (intent-router → lib/retrieval) retrieves over HellGraph/atoms, NOT the OCW brain.
 * This module is the bridge: it exposes the brain retrieval so the intent-router's knowledge/reasoning
 * lanes (explain_teach, qa_over_doc, compare_benchmark, research_lookup) can ground STEM answers on
 * the MIT-OCW corpus the benchmark proved works. Embeddings reuse lib/ollama (the shared embedder).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { embedText, generateOllamaText } from './ollama.js'
import { termSet } from './text-normalize.js'
import { decodeVec, l2norm } from './brain-vec.js'
import { decryptLine } from './at-rest.js'
import { academicBrainDir } from './brain-home.js'

const MAX = Number(process.env['STUDY_BRAIN_CAP'] || 30000)              // per-field cap
const GLOBAL_MAX = Number(process.env['STUDY_BRAIN_GLOBAL_CAP'] || 250000) // total resident across ALL fields

// The GOLD: worked solutions, exam questions, problem sets — the material that teaches HOW TO SOLVE, which
// is what an exam-style question actually needs. It is ~3% of the OCW corpus, and was being (a) capped-out
// by lecture/reference ordering at load and (b) out-ranked by lecture prose at score time. We now load ALL
// of it first, and boost it at ranking, so retrieval surfaces a worked solution over a lecture paragraph.
// STEM gold = worked solutions/exams; LEGAL gold = the black-letter law (statutes/regs/constitution) —
// the authoritative answer source, which should outrank commentary/opinions the same way.
const GOLD = new Set(['solution', 'exam', 'assignment', 'problem', 'pset', 'quiz', 'recitation',
  'statute', 'regulation', 'constitution', 'uscode', 'cfr'])
const MATERIAL_BOOST: Record<string, number> = {
  solution: 1.30, exam: 1.30, problem: 1.28, pset: 1.28, quiz: 1.22, assignment: 1.20, recitation: 1.10,
  constitution: 1.32, statute: 1.28, regulation: 1.26, uscode: 1.28, cfr: 1.26, code: 1.15, caselaw: 1.08,
  lecture: 1.05, reference: 0.92, syllabus: 0.80,
}
const materialBoost = (m: string): number => MATERIAL_BOOST[m] ?? 1.0

interface Chunk { text: string; slug: string; field: string; material: string; vec: Float32Array; norm: number }
const cache = new Map<string, Chunk[]>()
function loadedTotal(): number { let n = 0; for (const v of cache.values()) n += v.length; return n }

/** Fields the brain currently covers (biology, physics, mathematics, …). */
export function brainFields(): string[] {
  const BRAIN = academicBrainDir()
  if (!fs.existsSync(BRAIN)) return []
  return fs.readdirSync(BRAIN).filter((d) => {
    const p = path.join(BRAIN, d)
    return fs.statSync(p).isDirectory() && fs.readdirSync(p).some((f) => f.endsWith('.jsonl'))
  })
}

function loadField(field: string): Chunk[] {
  if (cache.has(field)) return cache.get(field)!
  const cap = Math.min(MAX, Math.max(0, GLOBAL_MAX - loadedTotal()))
  const dir = path.join(academicBrainDir(), field)
  // GOLD-FIRST: keep EVERY worked-solution / exam / pset chunk, then fill the remaining cap with
  // lecture/reference. Reads all files so the gold is never dropped by file ordering (the old loader
  // stopped at the cap in readdir order — so most exams/solutions in later courses were never loaded).
  const gold: Chunk[] = []
  const rest: Chunk[] = []
  const mk = (o: { text?: string; slug?: string; vec?: string; dims?: number }, material: string, fn: string): Chunk => {
    const vec = decodeVec(o.vec!, o.dims || 768)
    return { text: o.text!, slug: o.slug || fn, field, material, vec, norm: l2norm(vec) }
  }
  if (cap > 0 && fs.existsSync(dir)) {
    for (const fn of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
      for (const line of fs.readFileSync(path.join(dir, fn), 'utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          // Decrypt-on-read (brain shards are encrypted at rest by build-corpus). decryptLine passes legacy
          // plaintext shards straight through, so shipped/old corpora still load. Null = encrypted-with-other-key
          // or malformed → skip that line.
          const o = decryptLine(line) as { text?: string; slug?: string; vec?: string; dims?: number; material?: string } | null
          if (!o || !o.text || !o.vec) continue
          const material = (o.material || 'reference').toLowerCase()
          if (GOLD.has(material)) { if (gold.length < cap) gold.push(mk(o, material, fn)) }
          else if (rest.length < cap) rest.push(mk(o, material, fn))
        } catch { /* skip bad line */ }
      }
      if (gold.length >= cap && rest.length >= cap) break
    }
  }
  const out = gold.concat(rest.slice(0, Math.max(0, cap - gold.length)))
  cache.set(field, out)
  return out
}

export interface BrainHit { text: string; slug: string; field: string; material: string; score: number }

// ── PROMOTION layer: board-measured techniques wired into the product, OFF by default, flip ON once the
// board confirms the lift (keep all arms, promote only winners). Mapping:
//   Re2G rerank  → NOETICA_BRAIN_RERANK=1   (this fn)        gate/CRAG → NOETICA_BRAIN_GATE (caller-side)
//   qgen/HyDE    → already promoted (extraQueries, +4.3)     compute   → NOETICA_VERIFIED_COMPUTE (answer path)
// Re2G LLM listwise rerank (IBM Glass/Gliozzo NAACL'22): a relevance pass over the candidate pool before
// dedup+top-k. We already do dense + material-boost + lexical blend; this is the missing rerank stage.
const RERANK_N = Number(process.env['NOETICA_RERANK_N'] || 16)
async function rerankHits(query: string, hits: BrainHit[], keep: number): Promise<BrainHit[]> {
  const cands = hits.slice(0, Math.min(hits.length, RERANK_N))
  if (cands.length <= 1) return hits
  const list = cands.map((h, i) => `[${i + 1}] ${h.text.slice(0, 280).replace(/\s+/g, ' ')}`).join('\n')
  const model = process.env['NOETICA_RERANK_MODEL'] || process.env['MMLU_MODEL'] || 'qwen2.5:7b'
  let raw = ''
  try {
    raw = (await generateOllamaText({ model, temperature: 0, messages: [{ role: 'user',
      content: `Question: ${query}\n\nNumbered passages:\n${list}\n\nList the ${keep} passage numbers MOST useful for answering, most useful first, comma-separated (e.g. "3, 1, 7"). Numbers only.` }] })).content
  } catch { return hits }
  const order = (raw.match(/\d+/g) || []).map(Number).filter((n) => n >= 1 && n <= cands.length)
  const seen = new Set<number>(); const picked: BrainHit[] = []
  for (const n of order) { if (!seen.has(n)) { seen.add(n); picked.push(cands[n - 1]!); if (picked.length >= keep) break } }
  for (const h of hits) { if (!picked.includes(h)) picked.push(h) }   // fill with the remainder, original order
  return picked
}

/**
 * Retrieve the top-k most relevant OCW chunks for a query (cosine over the named fields).
 * Pass [] for fields to search the whole brain. This is what a dialogue lane calls to ground
 * a STEM answer on MIT-OCW substance instead of HellGraph atoms.
 */
export async function studyBrainRetrieve(query: string, fields: string[] = [], k = 6, extraQueries: string[] = []): Promise<BrainHit[]> {
  const fs2 = fields.length ? fields : brainFields()
  // Multi-query (the qgen/HyDE promotion, board +4.3): embed the literal query PLUS any hypothetical-answer
  // passages, and score each chunk by its BEST match across them — so a chunk that answers in the document's
  // vocabulary is found even when it doesn't echo the question's words. extraQueries=[] reduces to the
  // original single-query behaviour (back-compatible for existing callers).
  const queries = [query, ...extraQueries.filter((q) => q && q.trim().length > 0)]
  const qvs: Array<{ v: number[]; n: number }> = []
  for (const q of queries) {
    const v = await embedText(q)
    if (!v.length) continue
    let n = 0; for (const x of v) n += x * x
    qvs.push({ v, n: Math.sqrt(n) || 1 })
  }
  if (!qvs.length) return []
  const scored: BrainHit[] = []
  let dimMismatch = 0
  for (const f of fs2) {
    for (const c of loadField(f)) {
      // Dimension guard (correctness): query and chunk MUST come from the SAME embedder. The brain is
      // nomic-embed-text @ 768-d; if a caller passes a 384-d sidecar query, a Math.min truncation would
      // silently score GARBAGE. Skip instead, so a mismatch fails VISIBLY rather than returning noise.
      let best = -Infinity
      let matched = false
      for (const { v, n } of qvs) {
        if (c.vec.length !== v.length) continue
        matched = true
        let dot = 0
        for (let i = 0; i < v.length; i++) dot += v[i]! * c.vec[i]!
        const cos = dot / (n * c.norm)
        if (cos > best) best = cos
      }
      if (!matched) { dimMismatch++; continue }
      // material boost: a worked solution / exam / statute that's comparably relevant outranks lecture prose.
      scored.push({ text: c.text, slug: c.slug, field: c.field, material: c.material, score: best * materialBoost(c.material) })
    }
  }
  if (dimMismatch > 0) {
    console.warn(`[study-brain] DIMENSION MISMATCH: skipped ${dimMismatch} chunks (query dims ≠ brain vec dims). The brain is nomic-768 — query it with the same embedder, not the 384-d sidecar.`)
  }
  scored.sort((a, b) => b.score - a.score)
  // Hybrid re-rank over the dense top-pool: blend cosine with query-term overlap (lexical) so
  // exact-term matches that pure dense retrieval under-ranks get surfaced — the Anthropic
  // contextual-retrieval insight (BM25+dense), applied at the rerank step with NO extra model
  // or latency. Fixes flat-cosine mis-ordering (e.g. "central limit theorem" pulling unrelated
  // fields above the on-topic math/stats chunk). Whole-brain queries (no field filter) benefit
  // most, since that's where cross-field cosine collisions happen.
  // Proper lexical match: stopword-free, Porter-STEMMED term-set overlap (so "selection" matches
  // "selecting"/"selected"), not an ad-hoc substring includes on raw length≥4 tokens.
  const qterms = termSet(query)
  const pool = scored.slice(0, Math.max(k * 6, 40))
  if (qterms.size > 0) {
    for (const h of pool) {
      const ht = termSet(h.text)
      let hit = 0
      for (const w of qterms) if (ht.has(w)) hit++
      h.score = 0.82 * h.score + 0.18 * (hit / qterms.size) // blended relevance
    }
    pool.sort((a, b) => b.score - a.score)
  }
  // Re2G rerank (PROMOTABLE, off by default — flip NOETICA_BRAIN_RERANK=1 when the board confirms it wins):
  // an LLM listwise relevance pass over the pool before dedup+top-k. Best-effort: falls through on any error.
  if (process.env['NOETICA_BRAIN_RERANK'] === '1' && pool.length > k) {
    const reranked = await rerankHits(query, pool, Math.max(k * 2, 12))
    if (reranked.length) pool.splice(0, pool.length, ...reranked)
  }
  // Dedup near-identical passages by text prefix (same chunk often recurs across courses) —
  // feeding the model the same passage twice wastes context and adds no signal.
  const seen = new Set<string>()
  const out: BrainHit[] = []
  for (const h of pool) {
    const key = h.text.slice(0, 80)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(h)
    if (out.length >= k) break
  }
  return out
}

/** Whether the brain is available at all (so the router can fall back to HellGraph if not). */
export function studyBrainReady(): boolean {
  return brainFields().length > 0
}

// CLI self-test:  OCW_BRAIN=… npx tsx lib/study-brain.ts "a problem query" [field]
if (process.argv[1] && process.argv[1].endsWith('study-brain.ts')) {
  const q = process.argv[2] || 'what is the powerhouse of the cell'
  const fields = process.argv[3] ? [process.argv[3]] : []
  studyBrainRetrieve(q, fields, 8).then((hits) => {
    console.log(`# study-brain · fields=[${(fields.length ? fields : brainFields()).join(', ')}] · query="${q}"\n`)
    for (const h of hits) console.log(`  [${h.score.toFixed(3)} ${(h.material || '?').padEnd(9)} ${h.field}/${h.slug}] ${h.text.slice(0, 90).replace(/\s+/g, ' ')}…`)
  }).catch((e) => console.error('study-brain error:', e))
}
