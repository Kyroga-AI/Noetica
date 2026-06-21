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
 *   MMLU_ARMS         comma list of arms to run (default "baseline,brain")
 *   MMLU_SUBJECTS     comma list to restrict subjects (default: all brain-ready)
 *   MMLU_MAX_CHUNKS   per-field memory cap on loaded chunks (default 150000)
 *   MMLU_SEED         shuffle seed for the per-subject sample (default time-based)
 *   OLLAMA_HOST       ollama base (default http://127.0.0.1:11434)
 *
 * Usage:  OLLAMA_HOST=http://127.0.0.1:11434 npx tsx scripts/mmlu-brain-bench.ts
 *         MMLU_SUBJECTS=college_mathematics,abstract_algebra MMLU_PER_SUBJECT=20 npx tsx ...
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { embedText } from '../lib/ollama.js'

const HOME = os.homedir()
const BANK = path.join(HOME, '.noetica', 'corpus', 'benchmarks', 'mmlu_stem.json')
const BRAIN = process.env['OCW_BRAIN'] || path.join(HOME, 'Downloads', 'MIT OCW', '_brain')
const BASE = (process.env['OLLAMA_HOST'] || 'http://127.0.0.1:11434').replace(/\/$/, '')
const MODEL = process.env['MMLU_MODEL'] || 'llama3.2:3b'
const PER = Number(process.env['MMLU_PER_SUBJECT'] ?? 5)
const K = Number(process.env['MMLU_K'] || 4)
const ARMS = (process.env['MMLU_ARMS'] || 'baseline,brain').split(',').map((s) => s.trim()).filter(Boolean)
const MAX_CHUNKS = Number(process.env['MMLU_MAX_CHUNKS'] || 150_000)
const SEED = Number(process.env['MMLU_SEED'] ?? (Date.now() % 2147483647))
const TIMEOUT = Number(process.env['MMLU_TIMEOUT_MS'] || 120_000)
const LETTERS = ['A', 'B', 'C', 'D']
const TRANSCRIPT = path.join(HOME, '.noetica', `mmlu-brain-${Date.now()}.jsonl`)

// MMLU subject → brain field(s) that cover it.
const SUBJECT_FIELDS: Record<string, string[]> = {
  college_mathematics: ['mathematics'], abstract_algebra: ['mathematics'],
  high_school_mathematics: ['mathematics'], high_school_statistics: ['mathematics'],
  college_physics: ['physics'], conceptual_physics: ['physics'], high_school_physics: ['physics'],
  astronomy: ['physics', 'earth_planetary'],
  college_chemistry: ['chemistry'], high_school_chemistry: ['chemistry'],
  college_biology: ['biology', 'biological_eng'], high_school_biology: ['biology', 'biological_eng'],
  college_computer_science: ['eecs'], electrical_engineering: ['eecs'],
}

const FRONTIER = { 'Llama-3.2-3B (reported)': 63.4, 'Qwen2.5-7B (reported)': 74.2, 'GPT-4': 86.4 }

interface Q { subject: string; question: string; choices: string[]; answer: number }
interface Chunk { text: string; slug: string; material: string; vec: Float32Array; norm: number }

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
function loadField(field: string): Chunk[] {
  if (fieldCache.has(field)) return fieldCache.get(field)!
  const dir = fieldDir(field)
  const chunks: Chunk[] = []
  if (fs.existsSync(dir)) {
    for (const fn of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
      if (chunks.length >= MAX_CHUNKS) break
      const lines = fs.readFileSync(path.join(dir, fn), 'utf8').split('\n')
      for (const line of lines) {
        if (!line.trim() || chunks.length >= MAX_CHUNKS) continue
        try {
          const o = JSON.parse(line) as { text?: string; slug?: string; material?: string; vec?: string; dims?: number }
          if (!o.text || !o.vec) continue
          const text = cleanText(o.text)
          if (!usableChunk(text)) continue   // drop garbled / near-empty chunks before they can be injected
          const buf = Buffer.from(o.vec, 'base64')
          const vec = new Float32Array(buf.buffer, buf.byteOffset, (o.dims || 768))
          let n = 0; for (let i = 0; i < vec.length; i++) n += vec[i]! * vec[i]!
          chunks.push({ text, slug: o.slug || fn, material: o.material || 'reference', vec, norm: Math.sqrt(n) || 1 })
        } catch { /* skip bad line */ }
      }
    }
  }
  fieldCache.set(field, chunks)
  return chunks
}
function topK(qVec: number[], pools: Chunk[][], k: number): Chunk[] {
  let qn = 0; for (const v of qVec) qn += v * v; qn = Math.sqrt(qn) || 1
  const scored: Array<{ c: Chunk; s: number }> = []
  for (const pool of pools) for (const c of pool) {
    let dot = 0; const m = Math.min(qVec.length, c.vec.length)
    for (let i = 0; i < m; i++) dot += qVec[i]! * c.vec[i]!
    scored.push({ c, s: dot / (qn * c.norm) })
  }
  scored.sort((a, b) => b.s - a.s)
  // de-dupe near-identical texts, keep the k best distinct
  const out: Chunk[] = []; const seen = new Set<string>()
  for (const { c } of scored) { const key = c.text.slice(0, 80); if (seen.has(key)) continue; seen.add(key); out.push(c); if (out.length >= k) break }
  return out
}

// ── model ──────────────────────────────────────────────────────────────────────
const SYS = 'You are taking a multiple-choice exam. Reason in ONE short sentence, then end with a line "FINAL: X" where X is exactly one of A, B, C, or D.'
async function ask(prompt: string): Promise<string> {
  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, stream: false, temperature: 0, messages: [{ role: 'system', content: SYS }, { role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    const d = await res.json() as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> }
    const m = d.choices?.[0]?.message
    return (m?.content || m?.reasoning_content || '').trim()
  } catch { return '' }
}
function extractLetter(raw: string): string {
  const t = raw.trim()
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

  const tally: Record<string, Record<string, { c: number; n: number }>> = {} // arm → subject → {c,n}
  for (const arm of ARMS) tally[arm] = {}

  for (const subject of subjects) {
    const fields = SUBJECT_FIELDS[subject]!.filter(fieldReady)
    const pools = fields.map(loadField)
    const poolN = pools.reduce((a, p) => a + p.length, 0)
    const sample = shuffle(mmlu[subject]!, rand).slice(0, PER > 0 ? PER : mmlu[subject]!.length)
    process.stdout.write(`\n## ${subject}  (fields: ${fields.join('+')} · ${poolN.toLocaleString()} chunks · ${sample.length} q)\n`)
    for (const arm of ARMS) tally[arm]![subject] = { c: 0, n: 0 }

    for (let i = 0; i < sample.length; i++) {
      const q = sample[i]!
      const base = `${q.question}\n\n${q.choices.map((c, j) => `${LETTERS[j]}. ${c}`).join('\n')}`
      const gold = LETTERS[q.answer]
      const row: Record<string, unknown> = { subject, i, gold }

      // brain retrieval (shared across arms that need it)
      let context = ''
      if (ARMS.includes('brain')) {
        const qVec = await embedText(`${q.question}\n${q.choices.join(' ')}`)
        const hits = topK(qVec, pools, K)
        context = hits.map((h, n) => `[${n + 1}] ${h.text.slice(0, 500)}`).join('\n\n')
        row['sources'] = hits.map((h) => `${h.slug}:${h.material}`)
      }

      // Same answer-format rule on BOTH arms — the only difference between arms is the
      // injected context, so the comparison stays fair.
      const ANSWER_RULE = '\n\nReason in ONE short sentence, then output exactly one final line: "FINAL: X" (X = A, B, C, or D).'
      const marks: string[] = []
      for (const arm of ARMS) {
        const prompt = arm === 'brain'
          ? `Relevant MIT course notes (use only what helps; ignore noise and fragments):\n\n${context}\n\nExam question:\n${base}${ANSWER_RULE}`
          : `${base}${ANSWER_RULE}`
        const letter = extractLetter(await ask(prompt))
        const ok = letter === gold
        const t = tally[arm]![subject]!; t.n++; if (ok) t.c++
        row[`${arm}_pred`] = letter || '?'; row[`${arm}_ok`] = ok
        const tag = arm === 'baseline' ? 'base' : arm === 'brain' ? 'brain' : arm
        marks.push(`${tag}:${ok ? '✓' : '✗'}${letter || '?'}`)
      }
      fs.appendFileSync(TRANSCRIPT, JSON.stringify(row) + '\n')
      console.log(`  ${String(i + 1).padStart(3)}. ${marks.join('  ')}  /${gold}`)
    }
  }

  // ── summary ──
  console.log(`\n# ════════ results (model ${MODEL}) ════════`)
  const header = `  ${'subject'.padEnd(26)}` + ARMS.map((a) => a.padStart(10)).join('') + (ARMS.length === 2 ? '     Δ' : '')
  console.log(header)
  const totals: Record<string, { c: number; n: number }> = {}
  for (const arm of ARMS) totals[arm] = { c: 0, n: 0 }
  for (const subject of subjects) {
    const cells = ARMS.map((a) => { const t = tally[a]![subject]!; totals[a]!.c += t.c; totals[a]!.n += t.n; return `${pct(t.c, t.n)}%`.padStart(10) })
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
  console.log(`\n# reference (published overall MMLU):`)
  for (const [k, v] of Object.entries(FRONTIER)) console.log(`  ${k.padEnd(26)} ${v}%`)
  console.log(`\n# transcript: ${TRANSCRIPT}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
