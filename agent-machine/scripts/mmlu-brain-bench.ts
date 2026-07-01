#!/usr/bin/env -S node --import tsx
/**
 * mmlu-brain-bench — the thesis test. Sit the MMLU STEM exam TWICE with the SAME small
 * model: once CLOSED-BOOK (baseline) and once OPEN-BOOK over the MIT-OCW brain (retrieve
 * the most relevant lecture/exam chunks and inject them as context). If the brain arm
 * beats the baseline arm on the identical model, the lift is TECHNIQUE, not horsepower —
 * a 3B that studied the source material outscoring the same 3B that didn't.
 *
 * Clean-eval guarantee: the only inputs to the brain are OCW substance shards in
 * ~/Downloads/MIT OCW/_brain/<field>/*.jsonl. The MMLU questions/answers are NEVER
 * embedded — so this is an open-book exam (study the textbook, then sit it), not
 * memorizing the answer key.
 *
 * Each MMLU subject maps to the brain field(s) that cover it; a subject is only run if
 * its field has shards on disk, so this is runnable the moment math is vectorized and
 * grows automatically as physics/chem/bio/EECS come online.
 *
 * Env:
 *   MMLU_MODEL        answer model (default llama3.2:3b)
 *   MMLU_PER_SUBJECT  questions per subject (default 5; 0 = all)
 *   MMLU_K            retrieved chunks injected in the brain arm (default 4)
 *   MMLU_ARMS         comma list of arms to run (default "baseline,brain"); `refine` = AgentKB student→teacher trajectory-critique loop (Gap B); `tier` = tiered-ontology grounding (KKO upper→general→specific, PR #312)
 *   MMLU_SUBJECTS     comma list to restrict subjects (default: all brain-ready)
 *   MMLU_MAX_CHUNKS   per-field memory cap on loaded chunks (default 150000)
 *   MMLU_SEED         shuffle seed for the per-subject sample (default time-based)
 *   OLLAMA_HOST       ollama base (default http://127.0.0.1:11434)
 *   BRAIN_EXPLAIN_MISS=1  dump retrieved chunks + sources to stderr for every wrong brain answer (math regression diagnostic)
 *
 * Usage:  OLLAMA_HOST=http://127.0.0.1:11434 npx tsx scripts/mmlu-brain-bench.ts
 *         MMLU_SUBJECTS=college_mathematics,abstract_algebra MMLU_PER_SUBJECT=20 npx tsx ...
 *         MMLU_ARMS=baseline,brain,gate MMLU_PER_SUBJECT=30 MMLU_SEED=1729 npx tsx ...  (gate = CRAG adaptive retrieval; run to fix math −7%)
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { ensureOperatorImport, extractCode } from '../lib/exec-verify.js'
import { embedText } from '../lib/ollama.js'
import { sanitizeRetrieved } from '../lib/rag-trust.js'
import { councilVote, learnedCouncilVote } from '../lib/council.js'
import { fetchConceptDef, cleanTerm } from '../lib/concept-defs.js'
import { canonBridges, canonGround, canonEntities, canonAncestors } from '../lib/canon-lookup.js'
import { canonRoute } from '../lib/canon-route.js'
import { associativeRetrieve } from '../lib/graph-ppr.js'
import { decodeVec, l2norm } from '../lib/brain-vec.js'
import { reliabilityGate } from '../lib/reliability-gate.js'
import { formatEvidence, inlineBindPrompt, parseInlineAnswer, inlineFidelityStats } from '../lib/inline-bind.js'
import { cragVote, gateShouldRetrieve, acceptRetrievedAnswer, groundingGateShouldRetrieve } from '../lib/crag-gate.js'
import { critique, bestOfTemps } from '../lib/critic.js'                  // PRODUCTION best-of-N selection (server.ts mirror)
import { classifyComplexity } from '../lib/complexity-discipline.js'      // PRODUCTION posture classifier
import { emitReasoningBenchmark } from '../lib/reasoning-benchmark.js'     // 5th reasoning contract: each board = spec-conformant evidence
import { teacherStudentRefine, refinementChangedAnswer } from '../lib/teacher-critique.js'   // AgentKB student→teacher trajectory-critique loop (Gap B)
import { tieredGround, embeddingScorer } from '../lib/tiered-ground.js'                        // tiered-ontology grounding (KKO upper → general → specific, general-first)

const HOME = os.homedir()
const BANK = path.join(HOME, '.noetica', 'corpus', 'benchmarks', 'mmlu_stem.json')
const BRAIN = process.env['OCW_BRAIN'] || path.join(HOME, 'Downloads', 'MIT OCW', '_brain')
const BASE = (process.env['OLLAMA_HOST'] || 'http://127.0.0.1:11434').replace(/\/$/, '')
// Serverless inference API for the LLM (Together / Fireworks / OpenRouter / DeepInfra / Groq) — cheap
// per-token strong models, no VM/stockout/setup. Defaults to BASE (local ollama). Embeddings stay
// local (lib/ollama) so retrieval is free; only the expensive reasoning calls hit the API.
const API_BASE = (process.env['MMLU_API_BASE'] || BASE).replace(/\/$/, '')
const API_KEY = process.env['MMLU_API_KEY'] || ''
const AUTH: Record<string, string> = API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}
const MODEL = process.env['MMLU_MODEL'] || 'llama3.2:3b'
const PER = Number(process.env['MMLU_PER_SUBJECT'] ?? 5)
const K = Number(process.env['MMLU_K'] || 4)
const SHOT_K = Number(process.env['MMLU_SHOT_K'] || 8)      // chunks injected after multi-shot union
const PER_SHOT = Number(process.env['MMLU_PER_SHOT'] || 3)  // chunks each query (broad + per-choice) contributes
const ARMS = (process.env['MMLU_ARMS'] || 'baseline,brain').split(',').map((s) => s.trim()).filter(Boolean)
const CONC = Number(process.env['MMLU_CONC'] || 6)   // questions scored concurrently — ollama calls are I/O; serial left the GPU idle
// PRE-EMBED: warm the query-embed cache for a subject BEFORE its generation-heavy scoring loop, while the GPU
// is idle. Then retrieval is a cache hit (pure-CPU cosine) and embeds never contend with generation — the root
// cause of the slow/flaky boards. Off with MMLU_PREEMBED=0.
const PREEMBED = process.env['MMLU_PREEMBED'] !== '0'
const PREEMBED_CONC = Number(process.env['MMLU_PREEMBED_CONC'] || 16)
// brain-ground the verified-compute formalization (#12): feed sympy the retrieved worked solutions so it
// IDENTIFIES the method instead of cold-parsing. Off (=0) → cold formalization, for the grounded-vs-cold A/B.
const COMPUTE_GROUND = process.env['MMLU_COMPUTE_GROUND'] !== '0'
// the EXAM NOTE CARD (scripts/build-notecard.py): a curated per-domain formula sheet the model brings into the
// test. Grounds the `notecard` arm AND the compute formalizer. Empty for a field until it's been mined.
const NOTECARD_DIR = process.env['NOTECARD_DIR'] || path.join(__dirname, '..', 'notecards')
const _notecardCache = new Map<string, string>()
function loadNotecard(fields: string[]): string {
  const key = fields.join('+')
  let c = _notecardCache.get(key)
  if (c === undefined) {
    const parts: string[] = []
    for (const f of fields) { try { parts.push(fs.readFileSync(path.join(NOTECARD_DIR, `notecard-${f}.md`), 'utf8').trim()) } catch { /* not mined yet */ } }
    c = parts.join('\n\n'); _notecardCache.set(key, c)
  }
  return c
}
const MMR_LAMBDA = Number(process.env['MMLU_MMR'] || 0) // >0 enables MMR diverse selection (relevance vs novelty); cluster_analysis showed top-8 collapse into ~2 cells
const MAX_CHUNKS = Number(process.env['MMLU_MAX_CHUNKS'] || 150_000)
const SEED = Number(process.env['MMLU_SEED'] ?? (Date.now() % 2147483647))
const TIMEOUT = Number(process.env['MMLU_TIMEOUT_MS'] || 120_000)
const LETTERS = ['A', 'B', 'C', 'D']
// CHECKPOINT: a stable path (MMLU_CHECKPOINT) makes the board RESUMABLE — a restart skips already-scored
// questions instead of redoing them, so a flake/crawl/kill costs ≤1 question, not the whole batch. The
// launcher syncs this file to GCS continuously, so the checkpoint is durable AND live-visible.
const TRANSCRIPT = process.env['MMLU_CHECKPOINT'] || path.join(HOME, '.noetica', `mmlu-brain-${Date.now()}.jsonl`)
const STATUS = process.env['MMLU_STATUS'] || ''   // per-batch {done,total,pct,ts} for live monitoring (no buffering)

// MMLU subject → brain field(s) that cover it.
const SUBJECT_FIELDS: Record<string, string[]> = {
  college_mathematics: ['mathematics'], abstract_algebra: ['mathematics'],
  high_school_mathematics: ['mathematics'], high_school_statistics: ['mathematics'],
  college_physics: ['physics'], conceptual_physics: ['physics'], high_school_physics: ['physics'],
  astronomy: ['physics', 'earth_planetary'],
  college_chemistry: ['chemistry'], high_school_chemistry: ['chemistry'],
  college_biology: ['biology', 'biological_eng'], high_school_biology: ['biology', 'biological_eng'],
  college_computer_science: ['eecs'], electrical_engineering: ['eecs'],
  // medicine board — the MMLU medical subjects graded against the 'medicine' brain (MedRAG textbooks).
  // Populate the bank with scripts/fetch_mmlu_subjects.py first. anatomy/genetics also draw on biology.
  anatomy: ['medicine', 'biology'], clinical_knowledge: ['medicine'], college_medicine: ['medicine', 'biology'],
  professional_medicine: ['medicine'], medical_genetics: ['medicine', 'biology'],
  // legal board — MMLU professional/jurisprudence subjects graded against the 'legal' brain.
  professional_law: ['legal'], jurisprudence: ['legal'], international_law: ['legal'],
  // commonsense-KG ablation (Stage 1) — 4-choice retrieval benches graded against the 'commonsense' brain
  // (CSKG+ConceptNet+DBpedia). A0=baseline vs A1=brain measures whether commonsense retrieval lifts the 7B.
  openbookqa: ['commonsense'], arc_challenge: ['commonsense'], arc_easy: ['commonsense'],
}

// FIELD_ADJ — co-prime / adjacent fields to WIDEN into when per-choice coverage is thin. The
// elimination retriever pulls these only when the in-field posterior isn't peaked (biochem needs
// chemistry+biology; a genetics problem needs probability from mathematics; astrophysics spans both).
const FIELD_ADJ: Record<string, string[]> = {
  mathematics: ['physics', 'eecs'], physics: ['mathematics', 'chemistry', 'earth_planetary'],
  chemistry: ['physics', 'biology', 'biological_eng'], biology: ['chemistry', 'biological_eng'],
  biological_eng: ['biology', 'chemistry'], eecs: ['mathematics', 'physics'], earth_planetary: ['physics'],
}

// SUBJECT_SLUG_HINT — within-field course boosting. The 'mathematics' field contains 89K chunks
// from 40+ courses; cosine alone can't distinguish abstract algebra from algebraic topology.
// The diagnostic (BRAIN_EXPLAIN_MISS=1) confirmed: abstract_algebra questions pull from 18.905/18.225
// (algebraic topology, combinatorics) instead of 18.703 (Modern Algebra). Boosting preferred slugs
// at ranking time re-weights toward the on-topic course before top-k selection. Boost = 1.25 for
// primary course, 1.15 for closely related. (materialBoost is orthogonal — applies on top.)
const SUBJECT_SLUG_HINT: Record<string, Map<string, number>> = {
  // Diagnostic: homomorphism questions pull 4/6 chunks from 18.225 (graph homomorphisms) vs 18.703.
  // 1.25× wasn't enough to beat raw cosine. Raised to 1.35×; 18.704 (representation theory) down 1.20.
  abstract_algebra:       new Map([['18-703', 1.35], ['18-704', 1.20], ['18-702', 1.15], ['18-700', 1.10]]),
  high_school_mathematics: new Map([['18-01',  1.20], ['18-02',  1.20], ['18-06',  1.15], ['18-03',  1.10]]),
  // college_mathematics covers algebra (18.703), linear algebra (18.06), real analysis (18.100), calc (18.01-03)
  // Diagnostic: ring/group questions pull from algebraic topology; factorial/combinatorics pulls probability.
  // Added: 18-703 (group/ring theory), 18-781 (number theory, for trailing zeros / Legendre), 18-a34 (Putnam)
  college_mathematics:     new Map([['18-703', 1.20], ['18-06',  1.20], ['18-100', 1.15], ['18-781', 1.15], ['18-a34', 1.15], ['18-01',  1.10], ['18-02', 1.10], ['18-03', 1.10]]),
  high_school_statistics:  new Map([['18-650', 1.25], ['18-600', 1.20], ['18-440', 1.20], ['18-655', 1.15]]),
  // Physics subfield hints — wave/optics/quantum pulled from wrong courses in prior runs
  college_physics:         new Map([['8-03',   1.20], ['8-04',   1.15], ['8-05',   1.15], ['8-06',   1.10]]),
  high_school_physics:     new Map([['8-01',   1.25], ['8-02',   1.20], ['8-03',   1.15]]),
  conceptual_physics:      new Map([['8-01',   1.25], ['8-02',   1.20]]),
}

const FRONTIER = { 'Llama-3.2-3B (reported)': 63.4, 'Qwen2.5-7B (reported)': 74.2, 'GPT-4': 86.4 }

interface Q { subject: string; question: string; choices: string[]; answer: number }
interface Chunk { text: string; slug: string; material: string; vec: Float32Array; norm: number; score?: number }

// ── seeded shuffle (mulberry32) ───────────────────────────────────────────────
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!] }
  return a
}

// ── chunk hygiene ──────────────────────────────────────────────────────────────
// OCW PDFs extract with glyph failures (U+FFFD �), control chars, and ragged
// whitespace. Injecting that raw confuses a small model into never committing to an
// answer. Clean it, then drop chunks that are mostly garbage so only legible material
// reaches the prompt. (The stored embedding was computed on the raw text — that's fine
// for retrieval; we only sanitize what we INJECT.)
function cleanText(s: string): string {
  return s
    .replace(/\uFFFD/g, ' ')                                  // failed-glyph replacement char
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // control chars (keep tab/nl/cr)
    // OCW page-footer boilerplate: "MIT OCW: 18.703 Modern Algebra", the "Prof. <Name>" attribution line,
    // and standalone page-number lines — pure noise the small model latches onto instead of the math.
    // Strip from what we INJECT (the stored embedding is unaffected).
    .replace(/\bMIT\s*OCW:[^\n]*/gi, '')
    .replace(/^[ \t]*Prof(?:essor)?\.?\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,2}[ \t]*$/gim, '')
    .replace(/^[ \t]*\d{1,3}[ \t]*$/gm, '')                    // standalone page numbers
    .replace(/[ \t]+/g, ' ')                                   // collapse spaces/tabs
    .replace(/ *\n[ \n]*/g, '\n')                              // collapse blank lines
    .trim()
}
function usableChunk(text: string): boolean {
  if (text.length < 100) return false
  const letters = (text.match(/[A-Za-z]/g) || []).length
  return letters >= 50   // enough real prose/symbols to be worth injecting
}

// ── brain: load a field's chunks into a compact in-memory index ────────────────
const fieldCache = new Map<string, Chunk[]>()
function fieldDir(field: string): string { return path.join(BRAIN, field) }
function fieldReady(field: string): boolean {
  const d = fieldDir(field)
  return fs.existsSync(d) && fs.readdirSync(d).some((f) => f.endsWith('.jsonl'))
}
// GOLD = worked solutions / exams / psets — the material that teaches HOW TO SOLVE. Applied here so the
// BOARD tests the SAME gold-first retrieval the product uses (lib/study-brain.ts) — otherwise the bench
// would grade a different, weaker retriever than ships.
const GOLD = new Set(['solution', 'exam', 'assignment', 'problem', 'pset', 'quiz', 'recitation',
  'statute', 'regulation', 'constitution', 'uscode', 'cfr'])
const MATERIAL_BOOST: Record<string, number> = {
  solution: 1.30, exam: 1.30, problem: 1.28, pset: 1.28, quiz: 1.22, assignment: 1.20, recitation: 1.10,
  constitution: 1.32, statute: 1.28, regulation: 1.26, uscode: 1.28, cfr: 1.26, code: 1.15, caselaw: 1.08,
  lecture: 1.05, reference: 0.92, syllabus: 0.80,
}
const materialBoost = (m: string): number => MATERIAL_BOOST[m] ?? 1.0
// defs arm: cache clean KG definitions across the board run (`${field}|${term}` → def | null). One live
// Wikipedia lookup per UNIQUE term; repeats within a field are free. null is cached too (don't re-miss).
const defsCache = new Map<string, string | null>()

// hop arm: iterative HippoRAG query-graph expansion (#14). HOP_MAX rounds; stop when self-consistency
// agreement ≥ HOP_CONF (confident) — only the uncertain questions pay for extra hops.
const HOP_MAX = Number(process.env['MMLU_HOP_MAX'] || 2)
const HOP_CONF = Number(process.env['MMLU_HOP_CONF'] || 0.7)

/**
 * hippoExpand — local HippoRAG: build a concept graph from the retrieved chunks (nodes = cleanTerm concepts,
 * edges = co-occurrence within a chunk), seed personalized-PageRank with the query → the associatively-central
 * concepts the lexical retrieval missed. These become the next hop's expansion queries (the multi-hop bridge).
 */
function hippoExpand(chunks: Array<{ text: string }>, query: string, topK = 5): string[] {
  const labelById = new Map<string, string>()
  const nodes: Array<{ id: string }> = []
  const edges: Array<{ from: string; to: string }> = []
  for (const ch of chunks) {
    const words = ch.text.toLowerCase().split(/[^a-z]+/).filter(Boolean)
    const concepts = new Set<string>()
    for (let j = 0; j < words.length && concepts.size < 12; j++) {
      const uni = cleanTerm(words[j]!); if (uni) concepts.add(uni)
      if (j + 1 < words.length) { const bi = cleanTerm(`${words[j]} ${words[j + 1]}`); if (bi) concepts.add(bi) }
    }
    const list = [...concepts]
    for (const c of list) if (!labelById.has(c)) { labelById.set(c, c); nodes.push({ id: c }) }
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) edges.push({ from: list[a]!, to: list[b]! })
  }
  // CURATED EDGES: augment the ephemeral co-occurrence graph with the canon's sense-aware cross-domain
  // bridges (related/same_as) so PPR can hop along real curated links, not just chunk co-occurrence.
  for (const c of [...labelById.keys()]) {
    for (const b of canonBridges(c)) {
      const bl = cleanTerm(b) ?? b.trim().toLowerCase()
      if (!bl) continue
      if (!labelById.has(bl)) { labelById.set(bl, bl); nodes.push({ id: bl }) }
      edges.push({ from: c, to: bl })
    }
  }
  if (nodes.length < 4) return []
  return associativeRetrieve(nodes, edges, labelById, query, { topK }).results.map((r) => r.label)
}

function loadField(field: string): Chunk[] {
  if (fieldCache.has(field)) return fieldCache.get(field)!
  const dir = fieldDir(field)
  // GOLD-FIRST: keep EVERY worked-solution/exam chunk, then fill the cap with reference. Reads all files
  // so gold is never dropped by file ordering.
  const gold: Chunk[] = []; const rest: Chunk[] = []
  if (fs.existsSync(dir)) {
    for (const fn of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
      const lines = fs.readFileSync(path.join(dir, fn), 'utf8').split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const o = JSON.parse(line) as { text?: string; slug?: string; material?: string; vec?: string; dims?: number }
          if (!o.text || !o.vec) continue
          const text = sanitizeRetrieved(cleanText(o.text)).clean   // glyph/ws cleanup + strip injection directives
          if (!usableChunk(text)) continue   // drop garbled / near-empty chunks before they can be injected
          const material = (o.material || 'reference').toLowerCase()
          const isGold = GOLD.has(material)
          if (isGold ? gold.length < MAX_CHUNKS : rest.length < MAX_CHUNKS) {
            const vec = decodeVec(o.vec, o.dims || 768) // aligned-safe shared codec
            ;(isGold ? gold : rest).push({ text, slug: o.slug || fn, material, vec, norm: l2norm(vec) })
          }
        } catch { /* skip bad line */ }
      }
      if (gold.length >= MAX_CHUNKS && rest.length >= MAX_CHUNKS) break
    }
  }
  const chunks = gold.concat(rest.slice(0, Math.max(0, MAX_CHUNKS - gold.length)))
  fieldCache.set(field, chunks)
  return chunks
}
function topK(qVec: number[], pools: Chunk[][], k: number): Chunk[] {
  let qn = 0; for (const v of qVec) qn += v * v; qn = Math.sqrt(qn) || 1
  const scored: Array<{ c: Chunk; s: number }> = []
  for (const pool of pools) for (const c of pool) {
    let dot = 0; const m = Math.min(qVec.length, c.vec.length)
    for (let i = 0; i < m; i++) dot += qVec[i]! * c.vec[i]!
    scored.push({ c, s: (dot / (qn * c.norm)) * materialBoost(c.material) }) // gold-first ranking
  }
  scored.sort((a, b) => b.s - a.s)
  // de-dupe near-identical texts, keep the k best distinct
  const out: Chunk[] = []; const seen = new Set<string>()
  for (const { c } of scored) { const key = c.text.slice(0, 80); if (seen.has(key)) continue; seen.add(key); out.push(c); if (out.length >= k) break }
  return out
}

// Multi-shot retrieval: a broad query (question + all choices) THEN one targeted query per answer
// choice — 2nd/3rd-shot specificity. Each option pulls the chunk that would confirm/refute IT, so
// the discriminating fact lands in context. For memorization subjects (biology) this is the
// difference between "the topic is in the brain" and "the answer is in the brain". Union by best
// cosine across shots, dedup, take the top finalK.
// embedCached — brain, qgen, champion and verify all re-embed the SAME per-choice queries.
// Memoize so each distinct query embeds once per run (cuts ollama calls ~half).
const _embCache = new Map<string, Promise<number[]>>()
function embedCached(text: string): Promise<number[]> {
  const k = text.slice(0, 240)
  let p = _embCache.get(k)
  if (!p) { p = embedText(text); _embCache.set(k, p) }
  return p
}

// cosine between two already-loaded chunk vectors (norms precomputed) — for MMR novelty
function chunkCos(a: Chunk, b: Chunk): number {
  let dot = 0; const m = Math.min(a.vec.length, b.vec.length)
  for (let i = 0; i < m; i++) dot += a.vec[i]! * b.vec[i]!
  return dot / ((a.norm || 1) * (b.norm || 1))
}

// ── hybrid retrieval: dense + BM25 lexical, fused by Reciprocal Rank Fusion (Anthropic contextual
// retrieval's contextual-BM25 + rank-fusion core). Catches exact-term matches dense embeddings miss.
const HYBRID = process.env['MMLU_HYBRID'] === '1'
const STOP_BM = new Set('the a an of to in is are and or for with on at by as be it this that which from we you i if then than into over under not no all any each its their his her our these those such can may will would could should has have had do does did but also more most some many one two'.split(' '))
function terms(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP_BM.has(w))
}
const bm25Cache = new WeakMap<Chunk[][], { df: Map<string, number>; avgdl: number; N: number }>()
function bm25Index(pools: Chunk[][]) {
  let idx = bm25Cache.get(pools)
  if (idx) return idx
  const df = new Map<string, number>(); let totLen = 0, N = 0
  for (const pool of pools) for (const c of pool) {
    N++; const ts = terms(c.text); totLen += ts.length
    for (const t of new Set(ts)) df.set(t, (df.get(t) || 0) + 1)
  }
  idx = { df, avgdl: totLen / (N || 1), N }
  bm25Cache.set(pools, idx)
  return idx
}
function bm25Score(qTerms: Set<string>, text: string, idx: { df: Map<string, number>; avgdl: number; N: number }): number {
  const k1 = 1.5, b = 0.75
  const dts = terms(text), tf = new Map<string, number>()
  for (const t of dts) tf.set(t, (tf.get(t) || 0) + 1)
  const dl = dts.length || 1
  let score = 0
  for (const t of qTerms) {
    const f = tf.get(t); if (!f) continue
    const n = idx.df.get(t) || 0.5
    score += Math.log(1 + (idx.N - n + 0.5) / (n + 0.5)) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl / idx.avgdl))
  }
  return score
}

async function retrieveMulti(question: string, choices: string[], pools: Chunk[][], perShot: number, finalK: number, extra: string[] = [], slugBoosts: Map<string, number> = new Map()): Promise<Chunk[]> {
  const queries = [`${question}\n${choices.join(' ')}`, ...choices.map((c) => `${question}\n${c}`), ...extra.filter(Boolean)]
  const best = new Map<string, { c: Chunk; s: number }>()
  for (const query of queries) {
    const qv = await embedCached(query)
    if (!qv.length) continue
    let qn = 0; for (const v of qv) qn += v * v; qn = Math.sqrt(qn) || 1
    const shot: Array<{ c: Chunk; s: number }> = []
    for (const pool of pools) for (const c of pool) {
      // Dimension guard (correctness): query and chunk MUST come from the same embedder.
      // Math.min truncation would silently produce garbage scores on a dim mismatch — skip instead.
      if (c.vec.length !== qv.length) continue
      let dot = 0
      for (let i = 0; i < qv.length; i++) dot += qv[i]! * c.vec[i]!
      shot.push({ c, s: dot / (qn * c.norm) })
    }
    shot.sort((a, b) => b.s - a.s)
    for (const hit of shot.slice(0, perShot)) {
      const key = hit.c.text.slice(0, 80)
      const prev = best.get(key)
      if (!prev || hit.s > prev.s) best.set(key, hit)
    }
  }
  const cands = [...best.values()]
  if (HYBRID && cands.length > 1) {                       // fuse dense + BM25 via Reciprocal Rank Fusion
    const idx = bm25Index(pools)
    const qt = new Set(terms(`${question} ${choices.join(' ')} ${extra.join(' ')}`))
    const bm = new Map(cands.map((x) => [x.c, bm25Score(qt, x.c.text, idx)]))
    const dRank = new Map([...cands].sort((a, b) => b.s - a.s).map((x, i) => [x.c, i]))
    const bRank = new Map([...cands].sort((a, b) => bm.get(b.c)! - bm.get(a.c)!).map((x, i) => [x.c, i]))
    for (const x of cands) x.s = 1 / (60 + (dRank.get(x.c) ?? 99)) + 1 / (60 + (bRank.get(x.c) ?? 99))
  }
  // GOLD-FIRST ranking: applied after dense + RRF so a comparably-relevant worked solution / exam outranks
  // a lecture paragraph in the final context (the brain re-curation insight, in the brain/champion arms).
  // Slug-hint boost: within large fields (mathematics: 89K chunks/40+ courses) cosine alone can't distinguish
  // abstract algebra from algebraic topology. Diagnostic-confirmed fix: boost preferred course slugs.
  for (const x of cands) {
    x.s *= materialBoost(x.c.material)
    if (slugBoosts.size > 0) {
      for (const [prefix, factor] of slugBoosts) {
        if (x.c.slug.startsWith(prefix)) { x.s *= factor; break }
      }
    }
  }
  const ranked = cands.sort((a, b) => b.s - a.s)
  if (MMR_LAMBDA <= 0 || ranked.length <= finalK) return ranked.slice(0, finalK).map((x) => ({ ...x.c, score: x.s }))
  // MMR: greedily pick finalK balancing relevance (cosine to query) against novelty (low similarity
  // to already-picked). Fixes the redundancy where brute-force top hits collapse into one sub-topic,
  // so the K context slots carry K distinct facets instead of the same fact restated.
  const pool = ranked.slice(0, Math.max(finalK * 5, 40))
  const picked: Array<{ c: Chunk; s: number }> = []
  while (picked.length < finalK && pool.length) {
    let bi = 0, bScore = -Infinity
    for (let i = 0; i < pool.length; i++) {
      const r = pool[i]!
      let maxSim = 0
      for (const p of picked) { const sim = chunkCos(r.c, p.c); if (sim > maxSim) maxSim = sim }
      const mmr = MMR_LAMBDA * r.s - (1 - MMR_LAMBDA) * maxSim
      if (mmr > bScore) { bScore = mmr; bi = i }
    }
    picked.push(pool.splice(bi, 1)[0]!)
  }
  // Attach the relevance score as a COPY (never mutate the cached Chunk) so callers can read the
  // retrieval confidence (top cosine) without changing the rest of the return contract. picked[0]
  // is the highest-relevance pick (first MMR selection has no diversity penalty).
  return picked.map((x) => ({ ...x.c, score: x.s }))
}

// Re2G rerank (Glass/Gliozzo et al., NAACL 2022): the retrieve→RERANK→generate stage. We already do dense+RRF+
// gold+MMR; this adds the missing rerank — an LLM listwise relevance pass over a WIDE candidate set, keeping
// the top-K most useful before generation. The `rerank` arm isolates the rerank lift on the board.
const RERANK_N = Number(process.env['MMLU_RERANK_N'] || 16)
async function rerankLLM(question: string, choices: string[], cands: Chunk[], k: number): Promise<Chunk[]> {
  if (cands.length <= k) return cands
  const list = cands.map((h, n) => `[${n + 1}] ${h.text.slice(0, 280).replace(/\s+/g, ' ')}`).join('\n')
  const raw = await ask(`Question: ${question}\nChoices: ${choices.join(' / ')}\n\nNumbered passages:\n${list}\n\nList the ${k} passage numbers MOST useful for answering, most useful first, comma-separated (e.g. "3, 1, 7"). Numbers only.`)
  const order = (raw.match(/\d+/g) || []).map(Number).filter((n) => n >= 1 && n <= cands.length)
  const seen = new Set<number>(); const picked: Chunk[] = []
  for (const n of order) { if (!seen.has(n)) { seen.add(n); picked.push(cands[n - 1]!); if (picked.length >= k) break } }
  for (const h of cands) { if (picked.length >= k) break; if (!picked.includes(h)) picked.push(h) }   // model under-returned → fill by retrieval order
  return picked.slice(0, k)
}

// probePosterior — the shared elimination ENGINE: per-choice evidence → a NORMALIZED conditional posterior
// over the choices (the doors), updated sequentially (Bayes) across probe rounds, with a saturation gate
// that WIDENS into co-prime fields until one door wins. eliminateArm and fiftyFiftyArm both build on this,
// so the Monty-Hall math lives in ONE place. Evidence is a log-likelihood-ratio (SUPPORT raises a door's
// odds, REFUTE lowers them, INSUFFICIENT is neutral); softmax normalizes, so refuting a door transfers its
// mass to the SURVIVORS — because P sums to 1 and exactly one door is correct.
async function probePosterior(question: string, choices: string[], pools: Chunk[][], wider: Chunk[][]):
  Promise<{ post: number[]; covered: boolean[]; rounds: number }> {
  const n = choices.length
  const logit = new Array<number>(n).fill(0)          // log-odds per door; uniform prior ⇒ all 0. Evidence is
  const covered = new Array<boolean>(n).fill(false)   // multiplicative in P = additive in log (sequential Bayes)
  let rounds = 0
  const K = Number(process.env['MMLU_ELIM_K'] || 2)   // evidence temperature: how hard one verdict moves the odds
  const probe = async (ps: Chunk[][]) => {
    if (!ps.length) return
    rounds++
    await Promise.all(choices.map(async (ch, i) => {
      const hits = await retrieveMulti(question, [ch], ps, PER_SHOT, 5)
      const ctx = hits.map((h, k) => `[${k + 1}] ${h.text.slice(0, 380)}`).join('\n\n')
      const raw = await ask(`MIT course evidence:\n${ctx}\n\nQuestion: ${question}\nCandidate answer: "${ch}"\n\nWeighing the evidence and sound reasoning on THIS candidate only, reply ONE line exactly: "VERDICT: SUPPORT|REFUTE|INSUFFICIENT conf 0.NN".`)
      const m = /VERDICT:\s*(SUPPORT|REFUTE|INSUFFICIENT)\D*([01](?:\.\d+)?)?/i.exec(raw)
      const v = m ? m[1]!.toUpperCase() : 'INSUFFICIENT'
      const conf = m && m[2] != null ? Math.min(1, Math.max(0, Number(m[2]))) : 0.5
      // log-likelihood-ratio: SUPPORT raises this door's odds, REFUTE lowers them, INSUFFICIENT is neutral
      // (0) — yet normalization still LIFTS it when the OTHER doors get refuted. That's the conditional part.
      if (v === 'SUPPORT') { logit[i]! += K * conf; covered[i] = true }
      else if (v === 'REFUTE') { logit[i]! -= K * conf; covered[i] = true }
    }))
  }
  const posterior = (): number[] => {                 // softmax = the normalized P(correct | evidence), Σ=1
    const mx = Math.max(...logit)
    const ex = logit.map((z) => Math.exp(z - mx))
    const Z = ex.reduce((a, b) => a + b, 0) || 1
    return ex.map((e) => e / Z)
  }
  const gap = (p: number[]): number => { const s = [...p].sort((a, b) => b - a); return (s[0] ?? 0) - (s[1] ?? 0) }
  await probe(pools)
  let p = posterior()
  // commit only when the posterior is PEAKED: every door probed, one door past a majority (>0.5) by a clear
  // margin. Otherwise WIDEN into co-prime fields and update the SAME posterior again (the saturation gate).
  if (!(covered.every(Boolean) && Math.max(...p) > 0.5 && gap(p) > 0.2)) { await probe(wider); p = posterior() }
  return { post: p, covered, rounds }
}

// eliminateArm — the Monty-Hall pick: commit to the most-probable door under the conditional posterior,
// tie-breaking AWAY from A (the position-bias trap). Never defaults to A.
async function eliminateArm(question: string, choices: string[], pools: Chunk[][], wider: Chunk[][]):
  Promise<{ letter: string; coverage: number; rounds: number; margin: number }> {
  const { post, covered, rounds } = await probePosterior(question, choices, pools, wider)
  const mx = Math.max(...post)
  const top = post.map((s, i) => ({ s, i })).filter((x) => mx - x.s < 1e-9)
  const best = top.length > 1 ? (top.find((x) => x.i !== 0)?.i ?? top[0]!.i) : top[0]!.i
  const s = [...post].sort((a, b) => b - a)
  return { letter: LETTERS[best]!, coverage: covered.filter(Boolean).length / choices.length, rounds, margin: (s[0] ?? 0) - (s[1] ?? 0) }
}

// fiftyFiftyArm — the "Who Wants to Be a Millionaire" 50:50 lifeline, fused with the conditional posterior.
// A strong test-taker doesn't pick 1-of-4; they ELIMINATE the two easy distractors, then deliberate on the
// hard pair. We do exactly that: (1) one posterior probe over all four doors → KEEP the top two, drop the
// rest; (2) a FOCUSED contrastive runoff on the survivors — fresh evidence for BOTH, "exactly one is
// correct: which, and why is the other wrong?", decided by a short self-consistency vote. The budget saved
// by not re-litigating the eliminated pair is spent discriminating the pair that's actually hard. The
// runoff is guarded to stay within the two survivors (else fall back to the higher-posterior one).
async function fiftyFiftyArm(question: string, choices: string[], pools: Chunk[][], wider: Chunk[][]):
  Promise<{ letter: string; eliminated: string[]; rounds: number }> {
  const { post, rounds } = await probePosterior(question, choices, pools, wider)
  const order = post.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p)
  const keep = order.slice(0, 2).map((x) => x.i)
  const drop = order.slice(2).map((x) => LETTERS[x.i]!)
  if (keep.length < 2) return { letter: LETTERS[order[0]!.i]!, eliminated: drop, rounds }
  const [a, b] = keep as [number, number]
  const evid = async (i: number): Promise<string> =>
    (await retrieveMulti(question, [choices[i]!], pools, PER_SHOT, 5)).map((h, k) => `[${k + 1}] ${h.text.slice(0, 360)}`).join('\n\n')
  const [ctxA, ctxB] = await Promise.all([evid(a), evid(b)])
  const runoff = `Two candidates remain (the others were eliminated). EXACTLY ONE is correct.\n\n` +
    `Question: ${question}\n\n` +
    `Option ${LETTERS[a]}: ${choices[a]}\nEvidence:\n${ctxA}\n\n` +
    `Option ${LETTERS[b]}: ${choices[b]}\nEvidence:\n${ctxB}\n\n` +
    `Decide which is correct and why the other is wrong. Output exactly one final line: "FINAL: X" (X = ${LETTERS[a]} or ${LETTERS[b]}).`
  const vote = await askVote(runoff, SC_K)
  let letter = vote.letter
  if (letter !== LETTERS[a] && letter !== LETTERS[b]) letter = LETTERS[post[a]! >= post[b]! ? a : b]!  // stay within the survivors
  return { letter, eliminated: drop, rounds }
}

// ── model ──────────────────────────────────────────────────────────────────────
const SYS = 'You are taking a multiple-choice exam. Reason in ONE short sentence, then end with a line "FINAL: X" where X is exactly one of A, B, C, or D.'
// The reason lane wants the OPPOSITE of brevity: explicit step-by-step chains (that's the whole point — it's
// what SOTA does and what self-consistency votes over). Overrides the terse default so non-reasoning models
// (e.g. qwen) actually engage CoT, not just R1-class models that reason regardless.
const REASON_RULE = '\n\nWork through this step by step, showing your reasoning, then output exactly one final line: "FINAL: X" (X = A, B, C, or D).'
const NO_THINK = process.env['MMLU_NO_THINK'] === '1'   // qwen3/r1: '/no_think' disables slow chain-of-thought traces → fast AND strong (the eval fix)
const nt = (p: string): string => (NO_THINK ? `${p} /no_think` : p)
const MAXTOK = Number(process.env['MMLU_MAX_TOKENS'] || 220)
// retry empty/timeout completions: a transient empty (contention, momentary timeout) must NOT score as a
// false ✗? abstain. Only a genuinely-empty reply after ASK_RETRIES tries is a real abstain.
const ASK_RETRIES = Number(process.env['MMLU_ASK_RETRIES'] || 2)
async function ask(prompt: string, temperature = 0): Promise<string> {
  const tries = Math.max(1, ASK_RETRIES)
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(`${API_BASE}/v1/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...AUTH },
        body: JSON.stringify({
          model: MODEL, stream: false, temperature, max_tokens: MAXTOK,
          // RELIABLE thinking-disable: the ` /no_think` text token (nt) is unreliable on the
          // OpenAI-compat endpoint; chat_template_kwargs.enable_thinking=false is the correct switch
          // for qwen3-class models (honored by vLLM/recent ollama; harmlessly ignored elsewhere).
          ...(NO_THINK ? { chat_template_kwargs: { enable_thinking: false } } : {}),
          messages: [{ role: 'system', content: SYS }, { role: 'user', content: nt(prompt) }],
        }),
        signal: AbortSignal.timeout(TIMEOUT),
      })
      const d = await res.json() as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> }
      const m = d.choices?.[0]?.message
      const out = (m?.content || m?.reasoning_content || '').trim()
      if (out) return out                                   // real completion
    } catch { /* timeout / network — fall through to retry */ }
    if (attempt < tries - 1) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))   // backoff
  }
  return ''                                                  // genuinely empty after retries → abstain
}

// askVote — self-consistency: sample K answers at temperature, return the MAJORITY letter.
// The single biggest universal MMLU lift in the literature, and it launders positional A-bias out
// of the answer (a bias toward "A" washes out across diverse samples). Unaffordable on CPU; cheap
// on the L4. k<=1 collapses to one temp-0 answer (voting off), so non-champion arms are unaffected.
const SC_K = Number(process.env['MMLU_SC_K'] || 5)

// tier arm: ONE embedding-scorer instance reused across ALL questions so the ~80 tier-concept embeddings (KKO
// categories + domain anchors + general nodes + spec topics) are computed ONCE and cached; only the query embeds
// per question. Created lazily on first use of the `tier` arm.
let _tierScorer: ReturnType<typeof embeddingScorer> | null = null
const PROD_N = Number(process.env['MMLU_PROD_N'] || process.env['NOETICA_BESTOF_N'] || 3)   // prod arm best-of-N (server default 3)
const SHUFFLE_M = Number(process.env['MMLU_SHUFFLE'] || 4)   // Medprompt choice-shuffle ensemble members (rotations cancel position bias)
const CISC = process.env['MMLU_CISC'] === '1'   // confidence-weighted self-consistency (Google 2025) — weight each vote by the model's stated confidence
function extractConf(raw: string): number {
  const m = /conf(?:idence)?[:\s]*([01]?(?:\.\d+)?|\d{1,3})\s*%?/i.exec(raw)
  if (!m) return 0.6
  let c = Number(m[1]); if (c > 1) c = c / 100
  return Math.min(1, Math.max(0.1, c || 0.6))
}
async function askVote(prompt: string, k: number): Promise<{ letter: string; agree: number }> {
  if (k <= 1) return { letter: extractLetter(await ask(prompt)), agree: 1 }
  // The voting kernel now lives in lib/crag-gate.ts (cragVote) so the bench exercises the SAME code production
  // uses — same Adaptive-SC early-stop + agreement metric. CISC weighting and the temp-0 empty-fallback are
  // wired in via the sampler/options closures, preserving the original behavior exactly.
  const p = CISC ? `${prompt}\nThen output your confidence as "CONFIDENCE: 0.NN".` : prompt
  const r = await cragVote(() => ask(p, 0.7), extractLetter, k, {
    weight: CISC ? extractConf : undefined,
    fallback: () => ask(prompt),
  })
  return { letter: r.choice, agree: r.agree }
}

// gen — neutral-system generation for query generation. MUST NOT use the MCQ SYS, or the model
// answers "FINAL: X" instead of writing the passage we want to embed.
async function gen(prompt: string): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...AUTH },
      body: JSON.stringify({ model: MODEL, stream: false, temperature: 0, max_tokens: 220, messages: [{ role: 'user', content: nt(prompt) }] }),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    const d = await res.json() as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> }
    const m = d.choices?.[0]?.message
    return (m?.content || m?.reasoning_content || '').trim()
  } catch { return '' }
}

// queryGen — proper query generation + expansion BEFORE retrieval. nomic-embed matches surface form,
// so a terse MCQ stem sits in question-space, not the textbook-prose-space the corpus lives in.
// We add two extra query shots (cheap on a GPU model; was unaffordable on CPU, cached per question):
//   • HyDE      — a hypothetical textbook passage answering the question, embedded in document-space
//   • step-back — the general concept/principle/theorem being tested, to surface governing material
const qgCache = new Map<string, string[]>()
async function queryGen(question: string, choices: string[]): Promise<string[]> {
  if (qgCache.has(question)) return qgCache.get(question)!
  const out: string[] = []
  const hyde = await gen(`Write a 2-3 sentence factual passage, in the style of a textbook, stating the facts, definitions, or laws needed to answer the following. Do NOT mention the question or the options; just assert the relevant knowledge directly.\n\nQuestion: ${question}\nOptions: ${choices.join(' | ')}`)
  if (hyde.replace(/\s+/g, ' ').trim().length > 20) out.push(hyde.replace(/\s+/g, ' ').trim().slice(0, 600))
  const sb = await gen(`Name the single general concept, principle, theorem, or topic this question tests. Reply with ONLY a short noun phrase (3-8 words), no sentence, no punctuation.\n\n${question}`)
  const sbc = (sb.split('\n')[0] || '').replace(/^[^a-zA-Z]+/, '').replace(/[."']+$/, '').trim()
  if (sbc.length > 2 && sbc.length < 80) out.push(sbc)
  qgCache.set(question, out)
  return out
}

// "Plug in each answer" — what a good student does. Instead of "pick one of four" (which a weak
// model answers with a positional A-bias), verify EACH choice independently against its own
// targeted evidence, then take the best-supported. Per-option scoring sidesteps the bias and forces
// the model to evaluate each option on its merits.
async function verifyArm(question: string, choices: string[], pools: Chunk[][]): Promise<{ letter: string; scores: number[] }> {
  const scores: number[] = []
  for (let i = 0; i < choices.length; i++) {
    const ctx = (await retrieveMulti(question, [choices[i]!], pools, PER_SHOT, 4)).map((h, n) => `[${n + 1}] ${h.text.slice(0, 400)}`).join('\n\n')
    const prompt = `Relevant MIT course notes (use only what helps):\n${ctx}\n\nQuestion: ${question}\nProposed answer: "${choices[i]}"\n\nUsing the notes and sound reasoning, is the proposed answer the CORRECT answer to the question? Reply on ONE line exactly: "VERDICT: YES conf 0.NN" or "VERDICT: NO conf 0.NN".`
    const raw = await ask(prompt)
    const m = /VERDICT:\s*(YES|NO)\D*([01](?:\.\d+)?)?/i.exec(raw)
    const yes = m ? /yes/i.test(m[1]!) : /\byes\b/i.test(raw)
    const conf = m && m[2] != null ? Math.min(1, Math.max(0, Number(m[2]))) : 0.5
    scores[i] = yes ? conf : -conf   // best-supported wins; an explicit NO pushes it negative
  }
  let best = 0; for (let i = 1; i < scores.length; i++) if (scores[i]! > scores[best]!) best = i
  return { letter: LETTERS[best]!, scores }
}
function extractLetter(raw: string): string {
  // Thinking models (qwen3/r1) emit <think>…</think> before the answer. Strip closed blocks,
  // and if max_tokens truncated mid-think (unclosed <think>), drop everything after it → '' (a
  // clean abstain) rather than latching onto a stray A–D inside the reasoning trace.
  const t = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').trim()
  // 1. explicit FINAL: directive (strongest) — tolerate **bold**, parens, spacing
  let m = /FINAL:\s*\**\(?\s*([A-D])\b/i.exec(t); if (m) return m[1]!.toUpperCase()
  // 2. "the answer is C", "answer: (C)", "correct answer = D"
  m = /\bans(?:wer)?\b[^A-Da-d]{0,12}\(?\*?([A-D])\b/i.exec(t); if (m) return m[1]!.toUpperCase()
  // 3. a parenthesized / trailing-paren letter near the end: "(C)" or "C)"
  m = /\(\s*([A-D])\s*\)|\b([A-D])\)/.exec(t.slice(-50)); if (m) return (m[1] || m[2])!.toUpperCase()
  // 4. fallback: the LAST standalone A–D anywhere in the reply
  m = /\b([A-D])\b(?![\s\S]*\b[A-D]\b)/.exec(t); return m ? m[1]!.toUpperCase() : ''
}
function pct(a: number, b: number): string { return b ? (100 * a / b).toFixed(1) : '0.0' }

// ── verified-compute arm: the model only PARSES; units + the law catalog compute and certify ──
const COMPUTE_PY = path.join(__dirname, 'compute_arm.py')
// HARD ceiling on every sympy/python subprocess. execFileSync with NO timeout waits forever — a pathological
// sympy solve()/integrate() froze the whole board at a subject boundary (done stuck → 15-min watchdog kill →
// resume re-runs the same subject → same hang: an unbreakable loop). On timeout it throws → the existing
// catch returns abstains → the board ALWAYS advances. Tunable via MMLU_SUBPROC_TIMEOUT_MS.
const SUBPROC_TIMEOUT = Number(process.env['MMLU_SUBPROC_TIMEOUT_MS'] || 120_000)
const EVAL_PY = path.join(__dirname, 'eval_sympy.py')
const AUTOFORM_K = Number(process.env['MMLU_AUTOFORM_K'] || 3)  // sympy formalizations sampled per question

// parse the numeric value of a choice (first number; supports a/b fractions)
function choiceNum(c: string): number | null {
  const frac = /(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/.exec(c)
  if (frac) { const d = Number(frac[2]); if (d) return Number(frac[1]) / d }
  const m = /-?\d+(?:\.\d+)?/.exec(c.replace(/,/g, ''))
  return m ? Number(m[0]) : null
}
// pull a single sympy expression out of the model's reply (strip fences / prose / "x = ")
function extractExpr(raw: string): string {
  let s = raw.trim()
  const fence = /```(?:python)?\s*([\s\S]*?)```/.exec(s); if (fence) s = fence[1]!.trim()
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.replace(/^[a-zA-Z_]\w*\s*=\s*/, '').replace(/[.;]+$/, '')
    if (/[0-9)]/.test(l) && l.length < 200) return l
  }
  return ''
}
// nearest numeric choice to a computed value — require a close (2% relative) match, else abstain
function nearestChoice(choices: string[], val: number): string {
  let best = -1, bd = Infinity
  for (let i = 0; i < choices.length; i++) {
    const n = choiceNum(choices[i]!); if (n == null) continue
    const d = Math.abs(n - val) / (Math.abs(n) + 1e-9)
    if (d < bd) { bd = d; best = i }
  }
  return best >= 0 && bd < 0.02 ? LETTERS[best]! : ''
}

// ── verified-operator compute: the proven +7 fix (lib/math_operators.py) ──────
// The 7B routes to the right operation reliably but writes specialized math WRONG (invalid cycle notation,
// complex roots for finite fields, unevaluated ODEs → 1/6). So OFFER it a verified library to CALL: the model
// extracts args + picks the operator, the tested library does the math. Measured 4/5→5/5 recovery on the losses.
const LIBDIR = path.join(__dirname, '..', 'lib')
const OPERATOR_API = `You have a verified Python library 'math_operators' (already correct — CALL it, never reimplement):
  permutation_index(cycle_str, n)               # index of <p> in S_n; cycle_str like '(1,2,5,4)(2,3)'
  finite_field_zeros(coeffs, p)                 # zeros over Z_p; coeffs highest-degree-first (x^2+1 -> [1,0,1])
  mod_pow(base, exponent, modulus)              # INTEGER modular exponentiation only (base**exponent % modulus) — NOT a general power/exponent operator
  linear_ode_eval(ode_lhs, x0, y0, x_eval)      # solve 'expr=0' in x and y(x); use Derivative(y,x); y(x0)=y0
  factorial_trailing_zeros_count(target)        # how many k have EXACTLY target trailing zeros in k!
  ring_char_product(component_chars)            # characteristic of a product ring; 0 for an infinite component
  count_real_intersections(eq_strs, var_names)  # # real solutions of a system of 'lhs=0' equations
  gcd(a,b)  /  lcm(a,b)
  slope(p1,p2)  /  distance_2d(p1,p2)           # p = (x,y) tuples
  solve_equations(eq_strs, var_names)           # solve a system 'lhs=0' (sympy syntax), e.g. word problems
  z_score(x, mean, sd)  /  normal_prob_less_than(z)   # P(Z<z) standard normal
  confidence_interval_mean(mean, sd, n, confidence)
  confidence_interval_proportion(phat, n, confidence)
  definite_integral(expr_str, var, a, b)        # integral of expr d(var) from a to b; bounds may be 'oo'/'-oo'
  derivative_at(expr_str, var, x0)              # d/d(var) expr_str evaluated at var=x0
  limit_at(expr_str, var, point)                # limit of expr_str as var -> point; point may be 'oo'/'-oo'
  determinant(matrix)                           # determinant of a square matrix (list-of-lists)
  eigenvalues(matrix)                           # eigenvalues of a square matrix (list-of-lists)
  solve_linear_system(A, b)                     # solve A x = b; A list-of-lists, b list -> x list
  n_choose_k(n, k)  /  n_permute_k(n, k)        # combinations C(n,k) / permutations P(n,k), exact integers
  kinematic_velocity(v0,a,t)  /  kinematic_displacement(v0,a,t)  /  kinematic_velocity_from_distance(v0,a,d)
  newtons_second_law(mass,accel,force)          # F=ma; pass two, get the third (others None)
  kinetic_energy(mass,velocity)  /  gravitational_pe(mass,height,g)  /  momentum(mass,velocity)
  work_done(force,distance,angle_deg)  /  power(work,time)
  ohms_law(voltage,current,resistance)          # V=IR; pass two, get the third (others None)
  density(mass,volume,density_val)              # rho=m/V; pass two, get the third (others None)
  molarity(moles,liters,molarity_val)           # M=mol/L; pass two, get the third (others None)
  moles_from_mass(mass_g, molar_mass)
  ideal_gas(P,V,n,T,R)                           # PV=nRT (R=0.082057 default); pass three, get the fourth (others None)
  dilution(M1,V1,M2,V2)                          # M1V1=M2V2; pass three, get the fourth (others None)
  ph_from_concentration(h_conc)  /  concentration_from_ph(ph)  /  percent_yield(actual, theoretical)
  expected_value(values, probs)  /  binomial_probability(n, k, p)  /  binomial_mean_sd(n, p)
  sample_mean(values)  /  sample_sd(values, population)  /  combination_probability(fav_n, fav_k, total_n, total_k)
  correlation(xs, ys)  /  r_squared(xs, ys)  /  linear_regression(xs, ys)   # Pearson r, R^2 (variance explained), OLS -> (slope, intercept)
Pick the operator, extract the arguments from the problem, and write a tiny program that imports from
math_operators and prints ONLY the final answer value on the last line. If none fit, write a short correct program.`

async function operatorCompute(question: string, choices: string[]): Promise<string> {
  const prompt = `${OPERATOR_API}\n\nProblem: ${question}\nChoices: ${choices.map((c, i) => `${LETTERS[i]}. ${c}`).join(' | ')}\n\nReturn ONLY a \`\`\`python code block.`
  const raw = await ask(prompt, 0)
  // was a naive local regex whose "no closing fence" fallback returned the RAW text — including the literal
  // leading '```python' marker on truncated generations (measured: 11/14 SyntaxErrors in one run were exactly
  // this). extractCode strips that marker even in the unclosed-fence case; reuse it instead of duplicating.
  const code = extractCode(raw) ?? ''
  if (!/print|math_operators/.test(code)) return ''
  // THE ACTUAL FIX SITE (was mistakenly applied only to lib/exec-verify.ts's separate operatorProgramOfThought,
  // which this bench's opcompute/prod arms never call — the importfix0701 board measured a fix that could never
  // fire). This is the real codegen path (the 'opc_*.py' tempfile below) that produced the v0 NameError leak.
  const code2 = ensureOperatorImport(code)
  const wrapped = `import sys\nsys.path.insert(0, ${JSON.stringify(LIBDIR)})\n${code2}`
  let out = ''
  try {
    const f = path.join(os.tmpdir(), `opc_${Date.now()}_${Math.random().toString(36).slice(2)}.py`)
    fs.writeFileSync(f, wrapped)
    out = execFileSync('python3', [f], { encoding: 'utf8', timeout: SUBPROC_TIMEOUT, maxBuffer: 4 * 1024 * 1024 })
    fs.rmSync(f, { force: true })
  } catch (e) { out = (e as { stdout?: string | Buffer })?.stdout?.toString() ?? '' }
  const lastLine = out.trim().split('\n').filter(Boolean).pop() ?? ''
  if (!lastLine) return ''
  const num = Number(lastLine.replace(/[[\],\s]/g, ''))               // numeric match (nearest choice)
  if (Number.isFinite(num) && /\d/.test(lastLine)) { const nl = nearestChoice(choices, num); if (nl) return nl }
  const norm = (s: string) => s.toLowerCase().replace(/[\s[\]{}()]/g, '').replace(/[.,]+$/, '')   // string match
  const t = norm(lastLine)
  for (let i = 0; i < choices.length; i++) if (norm(choices[i]!) === t) return LETTERS[i]!
  return ''
}
interface CompRes { answer: string | null; mode: string }
/** Score the whole compute arm for a subject in ONE python call (one sympy import). Each result
 *  is the verified answer letter, or null=abstain when no law fits / units reject the extraction. */
// autoformalization: LLM writes K sympy expressions per (numeric) question, eval_sympy.py executes
// them deterministically, majority-vote the numeric result, match to the nearest choice. Self-
// consistency over formalizations IS the verification. Attacks the computational ceiling.
async function autoformBatch(qs: Q[]): Promise<CompRes[]> {
  const res: CompRes[] = qs.map(() => ({ answer: null, mode: 'abstain' }))
  const exprs: Array<{ id: number; expr: string }> = []
  await Promise.all(qs.map(async (q, i) => {
    if (!q.choices.every((c) => choiceNum(c) != null)) return    // only numeric-answer questions
    for (let s = 0; s < AUTOFORM_K; s++) {
      const raw = await ask(`Solve this exam problem by writing ONE Python expression (sympy is available: sqrt, pi, factorial, binomial, Rational, exp, log, sin/cos, solve, ...) that evaluates to the numeric answer. Output ONLY the expression on a single line — no words, no units.\n\n${q.question}`, s === 0 ? 0 : 0.7)
      const e = extractExpr(raw)
      if (e) exprs.push({ id: i, expr: e })
    }
  }))
  if (!exprs.length) return res
  const byId = new Map<number, number[]>()
  try {
    const out = execFileSync('python3', [EVAL_PY], { input: exprs.map((e) => JSON.stringify(e)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env }, timeout: SUBPROC_TIMEOUT, killSignal: 'SIGKILL' })
    for (const line of out.split('\n')) {
      if (!line.trim()) continue
      try {
        const r = JSON.parse(line) as { id: number; val: number | null }
        if (r.val != null && typeof r.id === 'number') { const a = byId.get(r.id) ?? []; a.push(r.val); byId.set(r.id, a) }
      } catch { /* skip */ }
    }
  } catch { return res }
  for (const [id, vals] of byId) {
    const cnt = new Map<number, number>()
    for (const v of vals) { const k = Math.round(v * 1e4) / 1e4; cnt.set(k, (cnt.get(k) ?? 0) + 1) }
    const top = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]
    if (!top) continue
    const letter = nearestChoice(qs[id]!.choices, top[0])
    if (letter) res[id] = { answer: letter, mode: `autoform×${top[1]}` }
  }
  return res
}

function computeBatch(qs: Q[], contexts: string[] = []): CompRes[] {
  const res: CompRes[] = qs.map(() => ({ answer: null, mode: 'abstain' }))
  if (!qs.length) return res
  // `context` = brain-retrieved worked solutions (gold) that ground sympy formalization (#12) — the LLM
  // identifies the method from real worked examples instead of cold-parsing the question.
  const input = qs.map((q, i) => JSON.stringify({ id: i, question: q.question, choices: q.choices, context: contexts[i] || '' })).join('\n') + '\n'
  // compute makes several LLM calls PER question, so a single per-batch SIGKILL (the old 120 s ceiling)
  // killed the whole subject before it finished → the arm fired on 0/300. compute_arm.py now self-bounds
  // each question (MMLU_COMPUTE_Q_TIMEOUT) and FLUSHES per line, so: (1) size the ceiling to the per-question
  // cap × batch, and (2) on timeout SALVAGE the partial stdout (every question completed before the kill)
  // from the error instead of discarding the whole subject. Incremental output + self-healing.
  const qCap = Number(process.env['MMLU_COMPUTE_Q_TIMEOUT'] || 30)
  const computeTimeout = Number(process.env['MMLU_COMPUTE_TIMEOUT_MS'] || Math.max(SUBPROC_TIMEOUT, (qs.length * (qCap + 5) + 30) * 1000))
  let out = ''
  try {
    out = execFileSync('python3', [COMPUTE_PY, '--batch'], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env }, timeout: computeTimeout, killSignal: 'SIGKILL' })
  } catch (e) {
    out = (e as { stdout?: string | Buffer })?.stdout?.toString() ?? ''   // keep questions finished before the kill
  }
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    try { const r = JSON.parse(line) as { id: number; answer: string | null; mode: string }; if (typeof r.id === 'number' && r.id < res.length) res[r.id] = { answer: r.answer, mode: r.mode } } catch { /* skip a bad line */ }
  }
  return res
}

// brain-ground the compute formalization (#12): the top WORKED-SOLUTION (gold) chunks for the question, so
// sympy formalizes FROM the method shown rather than a cold parse. Gold-first; empty when nothing relevant.
async function goldContext(q: Q, pools: Chunk[][], card = ''): Promise<string> {
  const hits = await retrieveMulti(q.question, q.choices, pools, PER_SHOT, 4)
  const gold = hits.filter((h) => /solution|exam|assignment|recitation|pset|problem/.test(h.material))
  const worked = (gold.length ? gold : hits).slice(0, 3).map((h) => h.text.slice(0, 600)).join('\n---\n')
  // the open-book exam: the FORMULA SHEET (note card) + the studied WORKED EXAMPLES (retrieved). Both ground sympy.
  return (card ? `Formula sheet (use these canonical formulas):\n${card}\n\n` : '') + (worked ? `Worked examples:\n${worked}` : '')
}

const KGBERT_RETRIEVE_PY = path.join(__dirname, 'kg-bert-retrieve.py')
// ground_kgbert arm: retrieve the structurally-nearest concepts (KG-BERT entity kNN) as a grounding block —
// the decorrelated retriever the operator-board proved the ground tier needs (canon defs did NOT lift it).
// One python call per subject (loads the .npz + bert-base once); returns a grounding string per question.
function kgbertGroundBatch(qs: Q[]): string[] {
  const res: string[] = qs.map(() => '')
  if (!qs.length || !process.env['MMLU_KGBERT_NPZ']) return res   // opt-in: needs the encoded .npz present
  const input = qs.map((q, i) => JSON.stringify({ id: i, question: q.question, choices: q.choices })).join('\n') + '\n'
  const args = [KGBERT_RETRIEVE_PY, '--batch', '--npz', process.env['MMLU_KGBERT_NPZ']!,
    '--device', process.env['MMLU_KGBERT_DEVICE'] || 'cuda', '--k', process.env['MMLU_KGBERT_K'] || '6']
  try {
    const out = execFileSync('python3', args, { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env }, timeout: SUBPROC_TIMEOUT, killSignal: 'SIGKILL' })
    for (const line of out.split('\n')) {
      if (!line.trim()) continue
      try { const r = JSON.parse(line) as { i: number; ground: string }; if (typeof r.i === 'number' && r.i < res.length) res[r.i] = r.ground } catch { /* skip */ }
    }
  } catch { /* no .npz / no torch → empty grounding, arm falls back to bare question */ }
  return res
}

const KTYPE_PY = path.join(__dirname, 'knowledge_type.py')
interface KType { types: string[]; solver: string }
/** Classify each question's knowledge type (one python call) so the CHAMPION arm understands the
 *  problem BEFORE approaching: compute the computational, verify the conceptual, retrieve the factual. */
function ktypeBatch(qs: Q[]): KType[] {
  const res: KType[] = qs.map(() => ({ types: ['BasicFacts'], solver: 'retrieve' }))
  if (!qs.length) return res
  const input = qs.map((q, i) => JSON.stringify({ id: i, question: q.question, choices: q.choices })).join('\n') + '\n'
  try {
    const out = execFileSync('python3', [KTYPE_PY, '--batch'], { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env }, timeout: SUBPROC_TIMEOUT, killSignal: 'SIGKILL' })
    for (const line of out.split('\n')) {
      if (!line.trim()) continue
      try { const r = JSON.parse(line) as { id: number; types: string[]; solver: string }; if (typeof r.id === 'number' && r.id < res.length) res[r.id] = { types: r.types, solver: r.solver } } catch { /* skip */ }
    }
  } catch { /* default all to retrieve */ }
  return res
}

async function main() {
  const mmlu = JSON.parse(fs.readFileSync(BANK, 'utf8')) as Record<string, Q[]>
  const rand = rng(SEED)

  // which subjects can we run? (their field has shards on disk)
  let subjects = Object.keys(mmlu).filter((s) => SUBJECT_FIELDS[s]?.some(fieldReady))
  if (process.env['MMLU_SUBJECTS']) {
    const want = new Set(process.env['MMLU_SUBJECTS'].split(',').map((s) => s.trim()))
    subjects = subjects.filter((s) => want.has(s))
  }
  const skipped = Object.keys(mmlu).filter((s) => !subjects.includes(s))

  console.log(`# MMLU brain-bench — model=${MODEL} | arms=[${ARMS.join(', ')}] | k=${K} | ${PER || 'all'}/subject | seed=${SEED}`)
  console.log(`# brain=${BRAIN} | base=${BASE}`)
  console.log(`# brain-ready subjects (${subjects.length}): ${subjects.join(', ')}`)
  if (skipped.length) console.log(`# waiting on vectorize (${skipped.length}): ${skipped.join(', ')}`)
  console.log(`# transcript: ${TRANSCRIPT}\n`)
  if (!subjects.length) { console.log('No brain-ready subjects yet — let the vectorizer finish a field first.'); return }

  const tally: Record<string, Record<string, { c: number; n: number; a?: number }>> = {} // arm → subject → {c,n,attempted}
  for (const arm of ARMS) { tally[arm] = {}; for (const s of subjects) tally[arm]![s] = { c: 0, n: 0, a: 0 } }

  // RESUME — load already-scored rows from the durable checkpoint → a skip-set + rebuild the tally, so a
  // restart continues instead of repeating work. THIS is what makes lost batches recoverable.
  const done = new Set<string>()
  if (fs.existsSync(TRANSCRIPT)) {
    for (const ln of fs.readFileSync(TRANSCRIPT, 'utf8').split('\n')) {
      if (!ln.trim()) continue
      try {
        const r = JSON.parse(ln) as Record<string, unknown>
        const sub = r['subject'] as string, key = `${sub}|${r['i']}`
        if (done.has(key) || !tally['baseline']?.[sub]) continue   // skip dups + subjects not in this run
        done.add(key)
        for (const arm of ARMS) {
          const t = tally[arm]![sub]!
          if (typeof r[`${arm}_pred`] === 'string' && r[`${arm}_pred`] !== '?') {
            t.n++; if (r[`${arm}_ok`]) t.c++
            if (arm === 'compute' && r['compute_mode'] && r['compute_mode'] !== 'abstain') t.a = (t.a ?? 0) + 1
          }
        }
      } catch { /* skip malformed */ }
    }
    if (done.size) console.log(`# RESUMED — ${done.size} questions already in the checkpoint; skipping them`)
  }
  let scored = done.size
  const grandTotal = subjects.reduce((a, s) => a + (PER > 0 ? Math.min(PER, mmlu[s]!.length) : mmlu[s]!.length), 0)
  const writeStatus = (subject: string): void => {
    if (!STATUS) return
    try { fs.writeFileSync(STATUS, JSON.stringify({ done: scored, total: grandTotal, pct: Math.round(100 * scored / Math.max(grandTotal, 1)), subject, ts: new Date().toISOString() })) } catch { /* best-effort */ }
  }

  for (const subject of subjects) {
    const fields = SUBJECT_FIELDS[subject]!.filter(fieldReady)
    const pools = fields.map(loadField)
    const widerPools = (ARMS.includes('elim') || ARMS.includes('fiftyfifty'))
      ? [...new Set(fields.flatMap((f) => FIELD_ADJ[f] ?? []).filter((f) => !fields.includes(f) && fieldReady(f)))].map(loadField)
      : []
    const poolN = pools.reduce((a, p) => a + p.length, 0)
    const sample = shuffle(mmlu[subject]!, rand).slice(0, PER > 0 ? PER : mmlu[subject]!.length)
    process.stdout.write(`\n## ${subject}  (fields: ${fields.join('+')} · ${poolN.toLocaleString()} chunks · ${sample.length} q)\n`)
    // tally pre-initialised + possibly resume-loaded above — do NOT reset it here
    // verified-compute arm scored up front (one python call per subject); used by compute + route + champion
    // NOTE: 'reason' can use the sympy-compute path, but the cold-parse compute_arm phase (LLM formalization)
    // is slow + mostly abstains on conceptual math, so gate it behind MMLU_REASON_COMPUTE=1 (off by default →
    // reason is pure long-CoT + self-consistency). Re-enable once task #12 (formalize-from-worked-solutions) lands.
    const reasonCompute = ARMS.includes('reason') && process.env['MMLU_REASON_COMPUTE'] === '1'
    const wantCompute = ARMS.includes('compute') || ARMS.includes('route') || ARMS.includes('champion') || ARMS.includes('gate') || ARMS.includes('groundgate') || reasonCompute || ARMS.includes('prod') || ARMS.includes('learned')
    // brain-ground (#12): retrieve worked-solution context per question (gold-first, warm cache) BEFORE the
    // sync compute subprocess, so sympy formalizes from the method, not a cold parse. COMPUTE_GROUND=0 → cold.
    const ncard = COMPUTE_GROUND ? loadNotecard(fields) : ''   // the formula sheet for this subject's field(s)
    const computeCtx: string[] = (wantCompute && COMPUTE_GROUND) ? await Promise.all(sample.map((q) => goldContext(q, pools, ncard))) : []
    const comp: CompRes[] = wantCompute ? computeBatch(sample, computeCtx) : []
    // knowledge-type per question (the 'understand first' step) — used by the champion router
    const kt: KType[] = (ARMS.includes('champion') || ARMS.includes('gate') || ARMS.includes('groundgate') || ARMS.includes('learned')) ? ktypeBatch(sample) : []
    const af: CompRes[] = ARMS.includes('autoform') ? await autoformBatch(sample) : []   // LLM-formalize → sympy-execute → vote
    const kgbertCtx: string[] = ARMS.includes('ground_kgbert') ? kgbertGroundBatch(sample) : []   // KG-BERT entity-kNN grounding

    const scoreQuestion = async (i: number) => {
      const q = sample[i]!
      const base = `${q.question}\n\n${q.choices.map((c, j) => `${LETTERS[j]}. ${c}`).join('\n')}`
      const gold = LETTERS[q.answer]
      // emit question + choices into the checkpoint → the ckpt IS a reliable remediation queue (frontier
      // authors the canon delta per miss from this, no fragile external shuffle-reproduction).
      const row: Record<string, unknown> = { subject, i, gold, question: q.question, choices: q.choices }
      const routeDecision = canonRoute(q.question)
      row['canon_grounding'] = routeDecision.grounding_status
      if (routeDecision.grounding_status === 'ungrounded' && routeDecision.ungrounded_candidates.length)
        process.stderr.write(`    [ungrounded] q${i + 1} candidates: ${routeDecision.ungrounded_candidates.slice(0, 5).join(', ')}\n`)

      // brain retrieval (shared by the brain arm AND the route arm's fallback) — multi-shot:
      // a broad query + one targeted query per choice, union top-K. MMLU_SHOT_K sets how many
      // chunks land in context (default 8); MMLU_PER_SHOT how many each query contributes (default 3).
      const slugHints = SUBJECT_SLUG_HINT[subject] ?? new Map<string, number>()
      let context = ''
      if (ARMS.includes('brain') || ARMS.includes('route')) {
        const hits = await retrieveMulti(q.question, q.choices, pools, PER_SHOT, SHOT_K, [], slugHints)
        context = hits.map((h, n) => `[${n + 1}] ${h.text.slice(0, 500)}`).join('\n\n')
        row['sources'] = hits.map((h) => `${h.slug}:${h.material}`)
        row['brain_conf'] = Number((hits[0]?.score ?? 0).toFixed(3))   // retrieval confidence (top cosine) — the council's grounding signal
      }

      // queryGen arm: identical retriever + model, but with HyDE + step-back query shots added.
      // Same answer path as brain → the column isolates the retrieval lift from query generation.
      // Also built for champion, whose retrieve path uses this same HyDE/qgen context.
      let qgenContext = ''
      if (ARMS.includes('qgen') || ARMS.includes('champion') || ARMS.includes('gate') || ARMS.includes('groundgate')) {
        const extra = await queryGen(q.question, q.choices)
        row['qgen'] = extra.map((e) => e.slice(0, 70))
        const hits = await retrieveMulti(q.question, q.choices, pools, PER_SHOT, SHOT_K, extra, slugHints)
        qgenContext = hits.map((h, n) => `[${n + 1}] ${h.text.slice(0, 500)}`).join('\n\n')
        row['qgen_sources'] = hits.map((h) => `${h.slug}:${h.material}`)
        row['qgen_conf'] = Number((hits[0]?.score ?? 0).toFixed(3))   // qgen retrieval confidence
      }

      // Same answer-format rule on every model-answered arm — the only difference is the injected
      // context (brain) or the path taken (route), so the comparison stays fair.
      const ANSWER_RULE = '\n\nReason in ONE short sentence, then output exactly one final line: "FINAL: X" (X = A, B, C, or D).'
      const brainPrompt = `Relevant MIT course notes (use only what helps; ignore noise and fragments):\n\n${context}\n\nExam question:\n${base}${ANSWER_RULE}`
      let brainLetter: string | undefined // memoize so brain + route don't double-ask the model
      const askBrain = async (): Promise<string> => (brainLetter ??= extractLetter(await ask(brainPrompt)))
      const qgenPrompt = `Relevant MIT course notes (use only what helps; ignore noise and fragments):\n\n${qgenContext}\n\nExam question:\n${base}${ANSWER_RULE}`
      let qgenLetter: string | undefined
      const askQgen = async (): Promise<string> => (qgenLetter ??= extractLetter(await ask(qgenPrompt)))
      const ci = comp[i]
      const marks: string[] = []
      const results: Array<{ arm: string; ok: boolean; attempted: boolean }> = []
      for (const arm of ARMS) {
        let letter = ''; let mode = ''; let attempted = true
        try {                                    // ROBUST: contain each arm — a single arm's bug must not crash the question/batch/run
        if (arm === 'compute') {                 // verified compute only (abstains where no law fits)
          letter = ci?.answer ?? ''; mode = ci?.mode ?? 'abstain'; attempted = !!ci?.answer
        } else if (arm === 'route') {             // the dispatch: compute where computable, else retrieve
          if (ci?.answer) { letter = ci.answer; mode = ci.mode } else { letter = await askBrain(); mode = 'retrieve' }
        } else if (arm === 'brain') {
          letter = await askBrain()
        } else if (arm === 'rerank') {            // Re2G: retrieve WIDE → LLM listwise rerank → generate (the rerank stage we lacked)
          const wide = await retrieveMulti(q.question, q.choices, pools, PER_SHOT, RERANK_N, [], slugHints)
          const top = await rerankLLM(q.question, q.choices, wide, SHOT_K)
          const ctx = top.map((h, n) => `[${n + 1}] ${h.text.slice(0, 500)}`).join('\n\n')
          letter = extractLetter(await ask(`Relevant MIT course notes (use only what helps; ignore noise and fragments):\n\n${ctx}\n\nExam question:\n${base}${ANSWER_RULE}`)); mode = `rerank:${top.length}`
        } else if (arm === 'inline') {            // Phase 0.4: inline evidence binding — model cites which chunk it's grounding on
          // Forces explicit {letter, reasoning, cited:[{id,span}]} output so faithfulness is measurable per-answer,
          // not just post-hoc over the whole run. Feeds Metric 2 (inline fidelity) in provenance_eval.py.
          const hits = await retrieveMulti(q.question, q.choices, pools, PER_SHOT, SHOT_K, [], slugHints)
          const ev = formatEvidence(hits)
          const ibPrompt = inlineBindPrompt(q.question, q.choices, ev)
          const raw = (await ask(ibPrompt)) || ''
          const parsed = parseInlineAnswer(raw)
          letter = parsed.letter; mode = `inline:parse_ok=${parsed.parse_ok}`
          row['inline_cited'] = parsed.cited.map((c) => c.id)
          row['inline_spans'] = parsed.cited.map((c) => c.span.slice(0, 80))
          row['inline_parse_ok'] = parsed.parse_ok
          row['inline_n_cited'] = parsed.cited.length
          // Per-citation lexical support (0–1); provenance_eval.py runs NLI check post-hoc on this checkpoint
          const stats = inlineFidelityStats([parsed], ev)
          row['inline_grounded_rate'] = Number(stats.grounded_rate.toFixed(3))
        } else if (arm === 'ground') {            // CANON GROUNDING: the question's entities → glossary defs + related equations/models + prereq decomposition + bridges
          const g = canonGround(`${q.question} ${q.choices.join(' ')}`)
          letter = extractLetter(await ask(`${g ? g + '\n\n' : ''}Exam question:\n${base}${ANSWER_RULE}`)); mode = g ? 'ground' : 'no-canon'
        } else if (arm === 'ground_kgbert') {     // KG-BERT GROUNDING: structurally-nearest concepts (entity-vector kNN) — the decorrelated retriever
          const g = kgbertCtx[i] ?? ''
          letter = extractLetter(await ask(`${g ? g + '\n\n' : ''}Exam question:\n${base}${ANSWER_RULE}`)); mode = g ? 'kgbert' : 'no-kgbert'
        } else if (arm === 'cohere') {            // Choice-Coherence Elimination. EMITS the RAW per-choice feature
          // matrix (cohesion, uniqueness, set-incl) into the row — NOT just the argmax pick — so the transcript is
          // training data for the n-furcated combiner (no aggregation that loses the points). The letter is still
          // produced for the aggregate accuracy column: we keep BOTH the features and the measure.
          const setOf = (text: string): Set<string> => { const s = new Set<string>(); for (const e of canonEntities(text, 8)) { s.add(e.tkey); for (const a of canonAncestors(e.term)) s.add(a.toLowerCase()) } return s }
          const cos = (a: number[], b: number[]): number => { if (!a.length || !b.length) return 0; let s = 0, na = 0, nb = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) { s += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2 } return s / ((Math.sqrt(na) * Math.sqrt(nb)) || 1) }
          const muQ = await embedCached(`${q.question}\n${canonGround(q.question)}`)   // the question ("combined topics") centroid
          const TQ = setOf(q.question)
          const cvs: number[][] = []; const TCs: Array<Set<string>> = []
          for (const c of q.choices) { cvs.push(await embedCached(`${c}\n${canonGround(c)}`)); TCs.push(setOf(c)) }   // spelling-bee: expand + embed each choice
          const feats: Array<{ cohesion: number; uniqueness: number; incl: number; evid: number; comp_hit: number; pos: number; len: number; nents: number; ontopic: number; score: number }> = []
          let bi = 0, bs = -Infinity
          for (let i = 0; i < q.choices.length; i++) {
            const cohesion = cos(muQ, cvs[i]!)                                          // continuous: connection to the question
            const others = cvs.filter((v, j) => j !== i && v.length > 0)               // uniqueness: distance from the OTHER choices' centroid (the inversion signal)
            const muO = others.length ? others[0]!.map((_, d) => others.reduce((s, v) => s + (v[d] ?? 0), 0) / others.length) : []
            const uniqueness = others.length ? 1 - cos(cvs[i]!, muO) : 0
            let inter = 0; for (const t of TCs[i]!) if (TQ.has(t)) inter++
            const incl = TCs[i]!.size === 0 ? 0 : (inter > 0 ? inter / (new Set([...TQ, ...TCs[i]!]).size || 1) : -0.2)   // discrete set inclusion/exclusion
            const evid = (await retrieveMulti(q.question, [q.choices[i]!], pools, PER_SHOT, 1, [], slugHints))[0]?.score ?? 0   // verification: brain evidence support for THIS choice
            const compHit = ci?.answer === LETTERS[i] ? 1 : 0                           // verification (DEDUCED): sympy-verified compute picks this choice → near-certain when 1
            const score = 0.7 * cohesion + 0.2 * uniqueness + 0.1 * incl               // a DEFAULT blend for the arm's letter; the combiner relearns these weights per regime
            feats.push({ cohesion: +cohesion.toFixed(4), uniqueness: +uniqueness.toFixed(4), incl: +incl.toFixed(3),
              evid: +evid.toFixed(4), comp_hit: compHit,                                // verification columns (evidence + deduced)
              pos: i, len: +(q.choices[i]!.length / 120).toFixed(3), nents: TCs[i]!.size, ontopic: inter > 0 ? 1 : 0,   // structural + descriptive columns
              score: +score.toFixed(4) })
            if (score > bs) { bs = score; bi = i }
          }
          row['cohere'] = { pick: bi, gold: LETTERS.indexOf(gold), feats }             // RAW per-choice features (the points) — combiner training data; letter below = the aggregate measure
          letter = LETTERS[bi]!; mode = `cohere:${bs.toFixed(2)}`
        } else if (arm === 'ladder') {            // STAGED elimination: drop the weakest one at a time, Monty-Hall
          // re-normalize the posterior over the survivors at EACH stage, and record the per-stage state — so we
          // measure eliminate-1 (stage 0) vs 50:50 (stage 1) vs runoff (last) and learn WHERE to stop (the gap).
          const { post } = await probePosterior(q.question, q.choices, pools, widerPools)
          let cur = q.choices.map((_, i) => i)
          const stages: Array<{ k: number; eliminated: string; pick: string; gap: number; conf: number; post: Record<string, number> }> = []
          while (cur.length > 1) {
            const z = cur.reduce((s, i) => s + post[i]!, 0) || 1
            const p = cur.map((i) => ({ i, p: post[i]! / z })).sort((a, b) => b.p - a.p)   // Monty-Hall renorm over survivors
            const weakest = p[p.length - 1]!.i
            stages.push({ k: q.choices.length - cur.length, eliminated: LETTERS[weakest]!, pick: LETTERS[p[0]!.i]!,
              gap: +((p[0]!.p) - (p[1]?.p ?? 0)).toFixed(3), conf: +p[0]!.p.toFixed(3),
              post: Object.fromEntries(p.map((x) => [LETTERS[x.i]!, +x.p.toFixed(3)])) })
            cur = cur.filter((i) => i !== weakest)                                          // eliminate the weakest
          }
          row['ladder'] = { gold, stages }                                                 // stage0=eliminate-1, stage1=50:50, last=runoff — per-stage gap is the stopping classifier's signal
          letter = LETTERS[cur[0]!]!; mode = `ladder:${stages.length}st`
        } else if (arm === 'defs') {              // STRUCTURAL definition-grounding (concept-defs): CLEAN KG defs, not noisy transcripts
          // Tests the thesis (Wolfson §4 / audit #1): retrieval is bounded by ONTOLOGICAL alignment, not the
          // model — so ground on disambiguated Wikipedia definitions (field-qualified + embedding-WSD) instead
          // of lecture-transcript chunks. Term-ambiguity is fixed at the KG layer, not the router.
          const field = fields[0] ?? ''
          const termLine = await ask(`List the 2-3 key technical terms or named concepts needed to answer this question. Comma-separated, terms only, no explanation.\n\n${q.question}`)
          const terms = [...new Set(termLine.split(',').map((t) => cleanTerm(t) ?? t.trim().toLowerCase()).filter((t) => t.length > 2))].slice(0, 3)
          const defs: string[] = []
          for (const t of terms) {
            const key = `${field}|${t}`
            let def = defsCache.get(key)
            if (def === undefined) { def = (await fetchConceptDef(t, field))?.definition ?? null; defsCache.set(key, def) }
            if (def) defs.push(`- ${t}: ${def}`)
          }
          if (defs.length) { letter = extractLetter(await ask(`Relevant definitions:\n${defs.join('\n')}\n\n${base}${ANSWER_RULE}`)); mode = `defs:${defs.length}/${terms.length}` }
          else { letter = extractLetter(await ask(`${base}${ANSWER_RULE}`)); mode = 'defs:miss' }   // no clean def → closed-book (never worse than baseline for lack of grounding)
        } else if (arm === 'notecard') {          // OPEN-BOOK exam: answer with the domain's curated FORMULA SHEET
          // What a student actually brings into the test — the canonical equations for the field, all in context
          // (not top-k retrieved, not noisy prose). Only useful post-v4 (the formulas have to be in the brain).
          const card = loadNotecard(fields)
          if (card) { letter = extractLetter(await ask(`Exam formula sheet — these are the canonical formulas you may use:\n${card}\n\n${base}${ANSWER_RULE}`)); mode = `notecard:${fields.join('+')}` }
          else { letter = extractLetter(await ask(`${base}${ANSWER_RULE}`)); mode = 'notecard:none' }   // not mined yet → closed-book
        } else if (arm === 'hop') {               // HippoRAG ITERATIVE query-graph expansion (#14): uncertain → graph-hop → re-retrieve
          // Each hop: answer with the current context (SC vote = confidence); if uncertain, build a local
          // concept graph from those chunks and PPR-expand on the query → the associatively-bridged concepts
          // the lexical pass missed → re-retrieve with them. Only hard questions pay for extra hops.
          let ctx = await retrieveMulti(q.question, q.choices, pools, PER_SHOT, SHOT_K, [], slugHints)
          const expansion: string[] = []
          let h = 0
          for (; h < HOP_MAX; h++) {
            const ctxStr = ctx.map((x, n) => `[${n + 1}] ${x.text.slice(0, 500)}`).join('\n\n')
            const sc = await askVote(`Relevant MIT course notes (use only what helps; ignore noise and fragments):\n\n${ctxStr}\n\nExam question:\n${base}${ANSWER_RULE}`, SC_K)
            letter = sc.letter
            if (sc.agree >= HOP_CONF || h === HOP_MAX - 1) break                 // confident, or out of hops
            const hops = hippoExpand(ctx, q.question)                            // uncertain → PPR graph-hop
            if (!hops.length) break
            for (const e of hops) if (!expansion.includes(e)) expansion.push(e)
            ctx = await retrieveMulti(q.question, q.choices, pools, PER_SHOT, SHOT_K, expansion, slugHints)  // re-retrieve, expanded
          }
          mode = `hop:${h + 1}x`; row['hop_expansion'] = expansion.slice(0, 8)
        } else if (arm === 'qgen') {              // brain + HyDE/step-back query generation
          letter = await askQgen(); mode = 'qgen'
        } else if (arm === 'autoform') {          // autoformalization: LLM→sympy→execute→vote (abstains on non-numeric)
          const a = af[i]; letter = a?.answer ?? ''; mode = a?.mode ?? 'abstain'; attempted = !!a?.answer
        } else if (arm === 'gate') {              // CRAG adaptive retrieval: only retrieve when the model ISN'T already confident
          const k = kt[i] ?? { types: ['BasicFacts'], solver: 'retrieve' }
          const scClosed = await askVote(`${base}${ANSWER_RULE}`, SC_K)   // closed-book confidence probe (calibrated by SC agreement)
          row['gate_conf'] = Number(scClosed.agree.toFixed(2))
          if (!gateShouldRetrieve(scClosed.agree)) {                      // CONFIDENT → skip retrieval (don't inject noise — fixes saturated bio)
            letter = scClosed.letter; mode = 'gate:skip'
          } else if (k.solver === 'compute' && ci?.answer && ci.mode !== 'prog') {
            letter = ci.answer; mode = `gate:compute:${ci.mode}`          // computational → deterministic (stats/math)
          } else {
            const scRetr = await askVote(qgenPrompt, SC_K)                // uncertain → retrieve + vote
            if (acceptRetrievedAnswer(scRetr.agree, scClosed.agree)) { letter = scRetr.letter; mode = `gate:retrieve:${k.types?.[0] ?? '?'}` }
            else { letter = scClosed.letter; mode = 'gate:retrieve-rejected' }   // weak/ambiguous retrieval → keep reasoning (CRAG correction)
          }
        } else if (arm === 'reason') {            // SOTA math lane: verified sympy-compute when possible, else long-CoT + self-consistency. NO retrieval (parametric reasoning beats lecture fragments for known material).
          if (ci?.answer && ci.mode !== 'prog') {
            letter = ci.answer; mode = `reason:compute:${ci.mode}`   // exact computation (stats/algebra) — beats any chunk
          } else {
            const sc = await askVote(`${base}${REASON_RULE}`, SC_K)   // self-consistency over explicit step-by-step chains
            letter = sc.letter; mode = `reason:sc${SC_K}`; row['reason_conf'] = Number(sc.agree.toFixed(2))
          }
        } else if (arm === 'opcompute') {         // reason lane + VERIFIED-OPERATOR compute (the proven +7 fix): route computational
          // questions to lib/math_operators.py (model picks operator + args; tested library does the math), else CoT+SC.
          const computational = classifyComplexity(q.question).posture === 'compute'
            || /\b(find|compute|remainder|zeros|index|characteristic|how many|value of|solve|order of|divided by|intersection|slope|distance|gcd|lcm|least common|greatest common|probability|correlation|proportion|confidence|standard deviation|z-?score|the mean|how (much|far|fast|long)|what is the (value|slope|probability|mean|distance))\b/i.test(q.question)
          let oc = ''
          if (computational) oc = await operatorCompute(q.question, q.choices)
          if (oc) { letter = oc; mode = 'opcompute:op' }
          else { const sc = await askVote(`${base}${REASON_RULE}`, SC_K); letter = sc.letter; mode = `opcompute:sc${SC_K}`; row['reason_conf'] = Number(sc.agree.toFixed(2)) }
        } else if (arm === 'prod') {              // FAITHFUL mirror of the POST-WIRING server.ts deliberation — measures what SHIPS, not a strawman.
          // server.ts now serves an exam (compute_math/prove_reason-class) question via: operator-route compute lane
          // (operatorProgramOfThought over lib/math_operators.py, tried first on compute-posture turns, with cold-PoT
          // fallback) → no-retrieval CoT+self-consistency reason lane (runReasonLane wrapping cragVote, retrieval SKIPPED
          // for reason-lane intents). Because every MMLU item IS an inherently math/reasoning compute_math/prove_reason
          // intent, the dominant ship path is operator→reason — so prod now CONVERGES to the `opcompute` arm's logic
          // (that arm literally mirrors operatorProgramOfThought + the reason lane). Reuses the production kernels
          // operatorCompute (≈operatorProgramOfThought) and askVote (≈cragVote); NO retrieval — matching server.ts's
          // useReasonLane retrieval-skip and decideGrounding's never-skip-on-grounded (retrieval is N/A on this path).
          // The old prod arm mirrored the now-superseded gate path (sympy-compute + best-of-N critic) and was stale.
          const computational = classifyComplexity(q.question).posture === 'compute'
            || /\b(find|compute|remainder|zeros|index|characteristic|how many|value of|solve|order of|divided by|intersection|slope|distance|gcd|lcm|least common|greatest common|probability|correlation|proportion|confidence|standard deviation|z-?score|the mean|how (much|far|fast|long)|what is the (value|slope|probability|mean|distance))\b/i.test(q.question)
          let oc = ''
          if (computational) oc = await operatorCompute(q.question, q.choices)   // operator-route compute lane (server: operatorProgramOfThought)
          if (oc) { letter = oc; mode = 'prod:op' }
          else { const sc = await askVote(`${base}${REASON_RULE}`, SC_K); letter = sc.letter; mode = `prod:sc${SC_K}`; row['reason_conf'] = Number(sc.agree.toFixed(2)) }   // no-retrieval reason lane (server: runReasonLane→cragVote)
        } else if (arm === 'refine') {            // AgentKB student→teacher Reason-Retrieve-Refine (Gap B): a STUDENT answers with
          // a visible chain; a TEACHER reads that reasoning TRAJECTORY (not just the letter) and re-answers; bounded iterate
          // until the letter settles. retrieve dep is empty here so the measured lift is PURE trajectory-critique, isolated
          // from retrieval. Uses lib/teacher-critique.ts — the same bounded loop that ships. The council only votes on
          // answers; this is the only arm where one pass critiques another's steps.
          // CONFIDENCE-GATED override (the agentkb1 fix): the student answers via self-consistency (letter +
          // agreement=confidence) and shows one chain; the teacher re-answers via self-consistency (letter +
          // agreement=confidence). The teacher only OVERRIDES when its confidence beats the student's by a margin
          // (Skrynnik 2021 demonstrator-decay analog) — fixing the board regression where a weaker teacher
          // overturned correct student answers (helped 4 / hurt 13).
          const sVote = await askVote(`${base}${REASON_RULE}`, SC_K)      // student letter + confidence
          const studentChain = await ask(`${base}${REASON_RULE}`, 0.7)    // a visible chain for the teacher to read
          const margin = Number(process.env['MMLU_REFINE_MARGIN'] ?? 0.15)
          const rr = await teacherStudentRefine(
            { task: q.question, steps: [studentChain.slice(0, 600)], answer: sVote.letter, confidence: sVote.agree },
            {
              retrieve: () => [],
              critique: async (traj) => {
                const tp = `A student answered this multiple-choice question. Critique their reasoning, then give the correct answer.\n\nQuestion:\n${base}\n\nStudent reasoning:\n${traj.steps[traj.steps.length - 1] ?? ''}\nStudent's answer: ${traj.answer}\n\nIf the student is correct, restate their answer; if not, briefly explain the error and correct it.${REASON_RULE}`
                const tVote = await askVote(tp, SC_K)                     // teacher letter + confidence (SC agreement)
                return { critique: `teacher SC=${tVote.agree.toFixed(2)}`, revisedAnswer: tVote.letter, confidence: tVote.agree }
              },
            },
            { maxRounds: 2, overrideMargin: margin },
          )
          letter = rr.finalAnswer || sVote.letter
          const overrides = rr.rounds.filter((x) => x.overrideAccepted).length
          mode = `refine:r${rr.rounds.length}:ovr${overrides}${rr.converged ? ':conv' : ''}`
          row['refine_rounds'] = rr.rounds.length
          row['refine_changed'] = refinementChangedAnswer({ task: q.question, steps: [], answer: sVote.letter }, rr)
          row['refine_overrides'] = overrides
          row['refine_student_conf'] = Number(sVote.agree.toFixed(2))
        } else if (arm === 'tier') {              // TIERED-ONTOLOGY grounding (PR #312): KKO upper → general (connective tissue)
          // → specific, GENERAL-FIRST, via embedding cosine over in-repo canon (no external KBpedia download). Inject the
          // tier block (and, in prod, the verified experiences) then answer. Tests whether tier-structured grounding beats
          // the flat off-level nearest-neighbour drag that hurt the `brain` arm. One reused scorer caches concept embeddings.
          if (!_tierScorer) _tierScorer = embeddingScorer()
          const tg = await tieredGround(q.question, { scorer: _tierScorer.scorer, middleFloor: _tierScorer.middleFloor, lowerFloor: _tierScorer.lowerFloor })
          const sc = await askVote(`${tg.block}\n${base}${ANSWER_RULE}`, SC_K)
          letter = sc.letter
          mode = `tier:${tg.grounding.level}${tg.grounding.specific ? ':spec' : ''}`
          row['tier_level'] = tg.grounding.level
          row['tier_general'] = tg.grounding.general
          row['tier_grounded'] = tg.grounding.grounded
          row['tier_conf'] = Number(sc.agree.toFixed(2))
        } else if (arm === 'groundgate') {        // CHEAP gate: decide retrieve-vs-skip from canon entity COUNT — no SC probe
          const k = kt[i] ?? { types: ['BasicFacts'], solver: 'retrieve' }
          const nEnt = canonRoute(q.question).entities.length
          row['gate_entities'] = nEnt
          if (!groundingGateShouldRetrieve(nEnt)) {                       // ≥2 canon concepts → standard material → skip retrieval
            const scClosed = await askVote(`${base}${ANSWER_RULE}`, SC_K)
            letter = scClosed.letter; mode = `groundgate:skip:${nEnt}ent`; row['gate_conf'] = Number(scClosed.agree.toFixed(2))
          } else if (k.solver === 'compute' && ci?.answer && ci.mode !== 'prog') {
            letter = ci.answer; mode = `groundgate:compute:${ci.mode}`     // computational → deterministic (stats/math)
          } else {
            const scRetr = await askVote(qgenPrompt, SC_K)                // 0–1 canon concepts → retrieve + vote
            letter = scRetr.letter; mode = `groundgate:retrieve:${nEnt}ent`; row['gate_conf'] = Number(scRetr.agree.toFixed(2))
          }
        } else if (arm === 'elim') {              // Monty-Hall: per-choice confirm/REFUTE, posterior, coverage-gated widening
          const e = await eliminateArm(q.question, q.choices, pools, widerPools)
          letter = e.letter; mode = `elim:cov${Math.round(e.coverage * 100)}:r${e.rounds}`
          row['coverage'] = e.coverage; row['elim_rounds'] = e.rounds; row['elim_margin'] = Number(e.margin.toFixed(2))
        } else if (arm === 'fiftyfifty') {        // Millionaire 50:50 lifeline: posterior → drop 2 weakest → focused runoff on the final 2
          const f = await fiftyFiftyArm(q.question, q.choices, pools, widerPools)
          letter = f.letter; mode = `5050:elim[${f.eliminated.join('')}]:r${f.rounds}`
          row['eliminated'] = f.eliminated
        } else if (arm === 'verify') {            // plug EACH choice in, verify vs its evidence, pick best
          const v = await verifyArm(q.question, q.choices, pools)
          letter = v.letter; mode = 'verify'
          row['verify_scores'] = v.scores.map((s) => Number(s.toFixed(2)))
        } else if (arm === 'champion') {          // THE CROWN — a COUNCIL: ensemble every signal so it can't lose to a member
          const k = kt[i] ?? { types: ['BasicFacts'], solver: 'retrieve' }
          row['ktype'] = k.types
          if (k.solver === 'compute' && ci?.answer && ci.mode !== 'prog') {
            letter = ci.answer; mode = `compute:${ci.mode}`           // exact computation overrides the council
          } else {
            // Reuse the answers baseline/brain/qgen ALREADY produced this question (free — they run
            // before champion), add a diverse closed-book self-consistency reasoning vote, and take a
            // confidence-weighted majority. Designed so champion can't do worse than its members in the
            // typical case: agreement compounds, disagreement breaks toward the reasoning vote, and it
            // NEVER defaults to A (the trap the old verify path fell into — it picked A 31% vs gold 19%).
            // Gather the arm votes (the expensive LLM calls stay here), then COMBINE via the SHARED
            // lib/council.ts — the same grounding-weighted Council V2 combiner the product calls, so the
            // bench validates production code, not a parallel stack. MMLU_COUNCIL_V2=0 falls back to V1.
            const V2 = process.env['MMLU_COUNCIL_V2'] !== '0'
            if (typeof row['qgen_pred'] !== 'string' || row['qgen_pred'] === '?') row['qgen_pred'] = await askQgen() // ensure the 2nd retrieval vote
            let manipLetter: string | undefined
            if (process.env['MMLU_MANIP'] !== '0') {   // manipulation-layer voter (Self-Discover): compose a plan, then execute
              const sdPlan = await ask(`Name the 2-3 reasoning steps that best fit this problem (governing principle / sub-steps / eliminate options / compute / recall definition). Short numbered plan only.\n\n${q.question}`)
              manipLetter = extractLetter(await ask(`Execute this plan:\n${sdPlan}\n\n${base}${ANSWER_RULE}`))
            }
            const sc = await askVote(`${base}${ANSWER_RULE}`, SC_K)   // diverse reasoning vote (no retrieval noise)
            row['sc_agree'] = Number(sc.agree.toFixed(2))
            const cv = councilVote({
              baseline: typeof row['baseline_pred'] === 'string' ? row['baseline_pred'] : undefined,
              brain: typeof row['brain_pred'] === 'string' ? row['brain_pred'] : undefined,
              qgen: typeof row['qgen_pred'] === 'string' ? row['qgen_pred'] : undefined,
              // the board's top arms, now council voters (graceful undefined if they didn't run this question)
              gate: typeof row['gate_pred'] === 'string' ? row['gate_pred'] : undefined,
              medprompt: typeof row['medprompt_pred'] === 'string' ? row['medprompt_pred'] : undefined,
              brainConf: Number(row['brain_conf'] ?? 0), qgenConf: Number(row['qgen_conf'] ?? 0),
              manip: manipLetter, scLetter: sc.letter, scAgree: sc.agree,
            }, { v2: V2, manip: process.env['MMLU_MANIP'] !== '0' })
            letter = cv.letter
            mode = `council:${k.types?.[0] ?? '?'}`
          }
        } else if (arm === 'learned') {           // LEARNED council — logistic meta-combiner (signed weights, scripts/meta_combiner.py)
          // Reuse the per-arm votes already in `row` (run learned LAST in MMLU_ARMS), route through the
          // learned log-odds law instead of the hand-tuned councilVote. Head-to-head vs champion: the board
          // proves whether learned > hand-tuned before we promote it (keep all arms, promote only winners).
          const pick = (k: string): string | undefined => (typeof row[k] === 'string' && row[k] !== '?' ? row[k] as string : undefined)
          const cv = learnedCouncilVote({
            baseline: pick('baseline_pred'), brain: pick('brain_pred'), qgen: pick('qgen_pred'),
            gate: pick('gate_pred'), medprompt: pick('medprompt_pred'),
            elim: pick('elim_pred'), fiftyfifty: pick('fiftyfifty_pred'),
            compute: comp[i]?.answer || undefined, scLetter: pick('brain_pred') || pick('baseline_pred'),
            // CONDITIONERS — the learned weight varies by these (domain/ktype/grounding), not a flat global
            subject, ktype: (row['ktype'] as string[] | undefined) ?? kt[i]?.types,
            brainConf: Number(row['brain_conf'] ?? 0), qgenConf: Number(row['qgen_conf'] ?? 0),
          })
          letter = cv.letter; mode = 'learned'
        } else if (arm === 'medprompt') {         // Medprompt choice-shuffle ensemble — position (A) bias cancels by construction (Microsoft, 90.10% MMLU)
          const n = q.choices.length, M = Math.min(SHUFFLE_M, n) || n
          const votes = new Map<number, number>()
          for (let m = 0; m < M; m++) {
            const order = Array.from({ length: n }, (_, j) => (j + m) % n)   // rotation m: each choice visits each position across the ensemble
            const shuffled = order.map((oi) => q.choices[oi]!)
            const pr = `${q.question}\n\n${shuffled.map((c, j) => `${LETTERS[j]}. ${c}`).join('\n')}${ANSWER_RULE}`
            const p = LETTERS.indexOf(extractLetter(await ask(pr)))
            if (p >= 0 && p < n) { const orig = order[p]!; votes.set(orig, (votes.get(orig) ?? 0) + 1) }
          }
          let best = -1, bn = -1
          for (const [oi, c] of votes) if (c > bn) { bn = c; best = oi }
          letter = best >= 0 ? LETTERS[best]! : ''; mode = `medprompt×${M}`
        } else if (arm === 'l2m') {               // Least-to-Most (Google): decompose into sub-questions, solve in order
          const sub = await ask(`Break this exam question into 2–3 simpler sub-questions whose answers build to the solution. List them only, no answers.\n\n${q.question}`)
          letter = extractLetter(await ask(`Work through these sub-questions first, then the main question:\n${sub}\n\n${base}${ANSWER_RULE}`))
          mode = 'l2m'
        } else if (arm === 'selfdiscover') {      // Self-Discover (DeepMind): compose a reasoning structure, then follow it
          const plan = await ask(`Pick the 2–3 reasoning steps that best fit this problem (from: identify the governing principle/law, break into sub-steps, eliminate wrong options, compute/derive, recall the definition). Output a short numbered plan.\n\n${q.question}`)
          letter = extractLetter(await ask(`Execute this reasoning plan:\n${plan}\n\nOn:\n${base}${ANSWER_RULE}`))
          mode = 'selfdiscover'
        } else if (arm === 'tot') {               // Tree-of-Thoughts (Princeton/DeepMind): propose approaches, self-evaluate, solve with the best
          const appr = await ask(`List 3 distinct approaches to solve this question, one short line each.\n\n${q.question}`)
          letter = extractLetter(await ask(`Candidate approaches:\n${appr}\n\nPick the single most promising approach (one line on why), then carry it out on:\n${base}${ANSWER_RULE}`))
          mode = 'tot'
        } else if (arm === 'reflect') {           // process-supervision-lite (OpenAI PRM): self-verify the reasoning, revise a flawed step
          const first = await ask(`${base}${ANSWER_RULE}`)
          letter = extractLetter(await ask(`A student proposed this solution:\n${first}\n\nQuestion:\n${base}\n\nCheck each reasoning step for an error. If any step is wrong, correct it and give the right answer; otherwise confirm.${ANSWER_RULE}`))
          mode = 'reflect'
        } else {                                  // baseline (closed book)
          letter = extractLetter(await ask(`${base}${ANSWER_RULE}`))
        }
        } catch (e) { letter = ''; mode = `ERR:${String((e as Error)?.message ?? e).slice(0, 50)}`; attempted = false }   // arm abstains on failure; the run goes on
        const ok = letter === gold
        results.push({ arm, ok, attempted })
        row[`${arm}_pred`] = letter || '?'; row[`${arm}_ok`] = ok; if (mode) row[`${arm}_mode`] = mode
        marks.push(`${arm}:${ok ? '✓' : '✗'}${arm === 'compute' && !attempted ? '·' : (letter || '?')}`)
        if (!ok && arm === 'brain' && process.env['BRAIN_EXPLAIN_MISS'] === '1') {
          process.stderr.write(`\n[MISS brain] ${subject} | gold=${gold} got=${letter}\n`)
          process.stderr.write(`  Q: ${q.question.slice(0, 120)}\n`)
          process.stderr.write(`  sources: ${JSON.stringify(row['sources'] ?? [])}\n`)
          process.stderr.write(`  context_top:\n${context.slice(0, 600)}\n`)
        }
      }
      // vote_share (ensemble column): fraction of the answering arms that picked each letter — the per-choice
      // agreement signal, computed once all arm preds are in the row. A strong column the combiner can weight.
      {
        const voters = ['baseline', 'brain', 'rerank', 'inline', 'ground', 'qgen', 'notecard', 'gate', 'defs', 'hop', 'route']
        const votes: Record<string, number> = {}; let nv = 0
        for (const v of voters) { const p = row[`${v}_pred`]; if (typeof p === 'string' && p !== '?') { votes[p] = (votes[p] ?? 0) + 1; nv++ } }
        if (nv) row['vote_share'] = Object.fromEntries(LETTERS.slice(0, q.choices.length).map((L) => [L, +((votes[L] ?? 0) / nv).toFixed(3)]))
      }
      // vote_share (ensemble column): fraction of the answering arms that picked each letter — the per-choice
      // agreement signal, computed once all arm preds are in the row. A strong column the combiner can weight.
      {
        const voters = ['baseline', 'brain', 'rerank', 'ground', 'qgen', 'notecard', 'gate', 'defs', 'hop', 'route']
        const votes: Record<string, number> = {}; let nv = 0
        for (const v of voters) { const p = row[`${v}_pred`]; if (typeof p === 'string' && p !== '?') { votes[p] = (votes[p] ?? 0) + 1; nv++ } }
        if (nv) row['vote_share'] = Object.fromEntries(LETTERS.slice(0, q.choices.length).map((L) => [L, +((votes[L] ?? 0) / nv).toFixed(3)]))
      }
      // LIVE per-question heartbeat to stderr (the batched stdout board line only prints after a
      // whole CONC-batch finishes — that masked a slow run as a hang and burned hours). This fires
      // the instant each question resolves, so the log shows real liveness + pacing.
      process.stderr.write(`    ${new Date().toISOString().slice(11, 19)} q${i + 1}/${sample.length} done  ${marks.join(' ')}\n`)
      return { i, row, marks, gold, results }
    }

    // bounded-parallel over the NOT-yet-done questions (resume skips the rest); checkpoint + status each batch
    const todo = Array.from({ length: sample.length }, (_, i) => i).filter((i) => !done.has(`${subject}|${i}`))
    // PRE-EMBED PASS — embed this subject's deterministic retrieval queries (broad + per-choice, the same
    // strings retrieveMulti builds) up front while the GPU is idle, so the scoring loop's retrieval is a warm
    // cache hit and generation never competes with embeds. HyDE queries (generated) still embed live.
    if (PREEMBED && todo.length) {
      const warm = new Set<string>()
      for (const i of todo) {
        const q = sample[i]!
        warm.add(`${q.question}\n${q.choices.join(' ')}`)            // broad query
        for (const c of q.choices) warm.add(`${q.question}\n${c}`)   // per-choice queries
      }
      const wl = [...warm]
      process.stdout.write(`  pre-embedding ${wl.length} retrieval queries (GPU idle → no generation contention)…\n`)
      for (let s = 0; s < wl.length; s += PREEMBED_CONC) {
        await Promise.all(wl.slice(s, s + PREEMBED_CONC).map((qq) => embedCached(qq).catch(() => [] as number[])))
      }
    }
    // ROBUST: a HARD per-question deadline. The per-arm try/catch contains a THROWING arm; this contains a
    // HANGING one — any await that never resolves. On timeout the question resolves as an all-abstain row so the
    // checkpoint advances PAST it: no kill→resume loop on a poison question (the failure mode that ate days).
    const Q_DEADLINE = Number(process.env['MMLU_Q_DEADLINE_MS'] || 300_000)
    const scoreOrAbstain = (i: number): Promise<Awaited<ReturnType<typeof scoreQuestion>>> => Promise.race([
      scoreQuestion(i),
      new Promise<Awaited<ReturnType<typeof scoreQuestion>>>((resolve) => setTimeout(() => {
        const g = LETTERS[sample[i]!.answer]!
        resolve({ i, gold: g, row: { subject, i, gold: g, q_timeout_ms: Q_DEADLINE } as Record<string, unknown>,
          marks: ARMS.map(() => '⏱'), results: ARMS.map((arm) => ({ arm, ok: false, attempted: false })) })
      }, Q_DEADLINE)),
    ])
    for (let s = 0; s < todo.length; s += CONC) {
      const batch = await Promise.all(todo.slice(s, s + CONC).map((i) => scoreOrAbstain(i)))
      for (const r of batch) {
        for (const res of r.results) {
          const t = tally[res.arm]![subject]!; t.n++; if (res.ok) t.c++
          if (res.arm === 'compute' && res.attempted) t.a = (t.a ?? 0) + 1
        }
        // reliability gate (agreement × density) — the post-council selective signal; measured, not used to
        // change answers here. decision='answer' should track high accuracy; 'escalate' marks the coin-flip set.
        try {
          const preds = ['baseline', 'brain', 'rerank', 'ground', 'qgen', 'compute']
            .map((a) => r.row[`${a}_pred`]).filter((p): p is string => typeof p === 'string' && p !== '?')
          if (preds.length >= 2) {
            const g = reliabilityGate(sample[r.i]!.question, preds)
            r.row['gate_reliability'] = Number(g.confidence.toFixed(3))
            r.row['gate_decision'] = g.decision
            r.row['gate_agree'] = Number(g.agreement.toFixed(2))
            r.row['gate_typical'] = g.typical
          }
        } catch { /* gate is best-effort; never block the checkpoint */ }
        fs.appendFileSync(TRANSCRIPT, JSON.stringify(r.row) + '\n')   // durable per-question checkpoint
        scored++
        console.log(`  ${String(r.i + 1).padStart(3)}. ${r.marks.join('  ')}  /${r.gold}`)
        writeStatus(subject)   // PER-QUESTION → the stall watchdog sees progress even within a slow batch
      }
    }
  }

  // ── summary ──
  console.log(`\n# ════════ results (model ${MODEL}) ════════`)
  const header = `  ${'subject'.padEnd(26)}` + ARMS.map((a) => a.padStart(10)).join('') + (ARMS.length === 2 ? '     Δ' : '')
  console.log(header)
  const totals: Record<string, { c: number; n: number; a: number }> = {}
  for (const arm of ARMS) totals[arm] = { c: 0, n: 0, a: 0 }
  for (const subject of subjects) {
    const cells = ARMS.map((a) => { const t = tally[a]![subject]!; totals[a]!.c += t.c; totals[a]!.n += t.n; totals[a]!.a += t.a ?? 0; return `${pct(t.c, t.n)}%`.padStart(10) })
    let delta = ''
    if (ARMS.length === 2 && tally['brain'] && tally['baseline']) {
      const b = tally['brain'][subject]!, base = tally['baseline'][subject]!
      const d = (100 * b.c / b.n) - (100 * base.c / base.n)
      delta = `  ${d >= 0 ? '+' : ''}${d.toFixed(1)}`
    }
    console.log(`  ${subject.padEnd(26)}${cells.join('')}${delta}`)
  }
  const totLine = ARMS.map((a) => `${pct(totals[a]!.c, totals[a]!.n)}%`.padStart(10)).join('')
  let totDelta = ''
  if (ARMS.length === 2 && totals['brain'] && totals['baseline']) {
    const d = (100 * totals['brain'].c / totals['brain'].n) - (100 * totals['baseline'].c / totals['baseline'].n)
    totDelta = `  ${d >= 0 ? '+' : ''}${d.toFixed(1)}`
  }
  console.log(`  ${'── OVERALL'.padEnd(26)}${totLine}${totDelta}`)
  if (totals['compute']) {
    const cv = totals['compute']!
    console.log(`  ${'   ↳ compute'.padEnd(26)}  fired on ${cv.a}/${cv.n} (${pct(cv.a, cv.n)}%) · accuracy-on-fired ${pct(cv.c, cv.a)}%  (the verified-compute moat; rest abstain${ARMS.includes('route') ? ' → routed to brain' : ''})`)
  }
  console.log(`\n# reference (published overall MMLU):`)
  for (const [k, v] of Object.entries(FRONTIER)) console.log(`  ${k.padEnd(26)} ${v}%`)
  console.log(`\n# transcript: ${TRANSCRIPT}`)

  // ── emit the 5th reasoning contract: this board run as a spec-conformant ReasoningBenchmark.
  // Best-effort — a benchmark-emit failure must NOT break the board.
  try {
    const bm = emitReasoningBenchmark({
      totals, arms: ARMS, subjects, model: MODEL, seed: SEED, perSubject: PER, k: K,
    })
    if (bm) console.log(`# reasoning-benchmark: ${bm.id} (runRef ${bm.runRef})`)
  } catch (e) {
    console.warn('[reasoning-benchmark] emit skipped:', e instanceof Error ? e.message : String(e))
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
