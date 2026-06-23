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
import { embedText } from './ollama.js'
import { termSet } from './text-normalize.js'
import { decodeVec, l2norm } from './brain-vec.js'
import { academicBrainDir } from './brain-home.js'

const MAX = Number(process.env['STUDY_BRAIN_CAP'] || 30000)              // per-field cap
const GLOBAL_MAX = Number(process.env['STUDY_BRAIN_GLOBAL_CAP'] || 250000) // total resident across ALL fields

// The GOLD: worked solutions, exam questions, problem sets — the material that teaches HOW TO SOLVE, which
// is what an exam-style question actually needs. It is ~3% of the OCW corpus, and was being (a) capped-out
// by lecture/reference ordering at load and (b) out-ranked by lecture prose at score time. We now load ALL
// of it first, and boost it at ranking, so retrieval surfaces a worked solution over a lecture paragraph.
const GOLD = new Set(['solution', 'exam', 'assignment', 'problem', 'pset', 'quiz', 'recitation'])
const MATERIAL_BOOST: Record<string, number> = {
  solution: 1.30, exam: 1.30, problem: 1.28, pset: 1.28, quiz: 1.22, assignment: 1.20, recitation: 1.10,
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
          const o = JSON.parse(line) as { text?: string; slug?: string; vec?: string; dims?: number; material?: string }
          if (!o.text || !o.vec) continue
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

/**
 * Retrieve the top-k most relevant OCW chunks for a query (cosine over the named fields).
 * Pass [] for fields to search the whole brain. This is what a dialogue lane calls to ground
 * a STEM answer on MIT-OCW substance instead of HellGraph atoms.
 */
export async function studyBrainRetrieve(query: string, fields: string[] = [], k = 6): Promise<BrainHit[]> {
  const fs2 = fields.length ? fields : brainFields()
  const qv = await embedText(query)
  if (!qv.length) return []
  let qn = 0; for (const v of qv) qn += v * v; qn = Math.sqrt(qn) || 1
  const scored: BrainHit[] = []
  let dimMismatch = 0
  for (const f of fs2) {
    for (const c of loadField(f)) {
      // Dimension guard (correctness): query and chunk MUST come from the SAME embedder. The brain is
      // nomic-embed-text @ 768-d; if a caller passes a 384-d sidecar query, a Math.min truncation would
      // silently score GARBAGE. Skip instead, so a mismatch fails VISIBLY (empty/short results) rather
      // than returning plausible-looking noise.
      if (c.vec.length !== qv.length) { dimMismatch++; continue }
      let dot = 0
      for (let i = 0; i < qv.length; i++) dot += qv[i]! * c.vec[i]!
      // material boost: a worked solution / exam that's comparably relevant outranks a lecture paragraph.
      scored.push({ text: c.text, slug: c.slug, field: c.field, material: c.material, score: (dot / (qn * c.norm)) * materialBoost(c.material) })
    }
  }
  if (dimMismatch > 0) {
    console.warn(`[study-brain] DIMENSION MISMATCH: skipped ${dimMismatch} chunks (query ${qv.length}-d ≠ brain vec dims). The brain is nomic-768 — query it with the same embedder, not the 384-d sidecar.`)
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
