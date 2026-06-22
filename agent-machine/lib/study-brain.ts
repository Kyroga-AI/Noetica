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
import * as os from 'node:os'
import * as path from 'node:path'
import { embedText } from './ollama.js'

const BRAIN = process.env['OCW_BRAIN'] || path.join(os.homedir(), 'Downloads', 'MIT OCW', '_brain')
const MAX = Number(process.env['STUDY_BRAIN_CAP'] || 30000)

interface Chunk { text: string; slug: string; field: string; vec: Float32Array; norm: number }
const cache = new Map<string, Chunk[]>()

/** Fields the brain currently covers (biology, physics, mathematics, …). */
export function brainFields(): string[] {
  if (!fs.existsSync(BRAIN)) return []
  return fs.readdirSync(BRAIN).filter((d) => {
    const p = path.join(BRAIN, d)
    return fs.statSync(p).isDirectory() && fs.readdirSync(p).some((f) => f.endsWith('.jsonl'))
  })
}

function loadField(field: string): Chunk[] {
  if (cache.has(field)) return cache.get(field)!
  const dir = path.join(BRAIN, field)
  const out: Chunk[] = []
  if (fs.existsSync(dir)) {
    for (const fn of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
      if (out.length >= MAX) break
      for (const line of fs.readFileSync(path.join(dir, fn), 'utf8').split('\n')) {
        if (!line.trim() || out.length >= MAX) continue
        try {
          const o = JSON.parse(line) as { text?: string; slug?: string; vec?: string; dims?: number }
          if (!o.text || !o.vec) continue
          const buf = Buffer.from(o.vec, 'base64')
          const vec = new Float32Array(buf.buffer, buf.byteOffset, o.dims || 768)
          let n = 0; for (let i = 0; i < vec.length; i++) n += vec[i]! * vec[i]!
          out.push({ text: o.text, slug: o.slug || fn, field, vec, norm: Math.sqrt(n) || 1 })
        } catch { /* skip bad line */ }
      }
    }
  }
  cache.set(field, out)
  return out
}

export interface BrainHit { text: string; slug: string; field: string; score: number }

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
  for (const f of fs2) {
    for (const c of loadField(f)) {
      let dot = 0; const m = Math.min(qv.length, c.vec.length)
      for (let i = 0; i < m; i++) dot += qv[i]! * c.vec[i]!
      scored.push({ text: c.text, slug: c.slug, field: c.field, score: dot / (qn * c.norm) })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  // Dedup near-identical passages by text prefix (same chunk often recurs across courses) —
  // feeding the model the same passage twice wastes context and adds no signal.
  const seen = new Set<string>()
  const out: BrainHit[] = []
  for (const h of scored) {
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

// CLI self-test:  OCW_BRAIN=… npx tsx lib/study-brain.ts "what is natural selection"
if (process.argv[1] && process.argv[1].endsWith('study-brain.ts')) {
  const q = process.argv[2] || 'what is the powerhouse of the cell'
  studyBrainRetrieve(q, [], 3).then((hits) => {
    console.log(`# study-brain · fields=[${brainFields().join(', ')}] · query="${q}"\n`)
    for (const h of hits) console.log(`  [${h.score.toFixed(3)} ${h.field}/${h.slug}] ${h.text.slice(0, 100).replace(/\s+/g, ' ')}…`)
  }).catch((e) => console.error('study-brain error:', e))
}
