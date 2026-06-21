/**
 * solution-memory — the compounding loop for the coding agent.
 *
 *   verify  →  the verify-repair loop already proves a solution works (exit 0).
 *   memory  →  every VERIFIED solution is persisted (task + files + verify cmd + embedding).
 *   select  →  a new task retrieves the most-similar proven solutions and injects them as few-shot,
 *              so the agent stands on what already worked instead of re-deriving from scratch.
 *   measure →  every solve outcome is logged; qualityMetrics() returns the solve-rate OVER TIME so we
 *              can SHOW the loop compounds (rate up, attempts down) rather than just claim it.
 *
 * File-backed (JSONL under ~/.noetica), local-first, no external store. Embeddings via our Rust
 * embedder. Best-effort throughout — memory never blocks a solve.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { embedBatchLocal } from './embed-runtime.js'

const DIR = path.join(os.homedir(), '.noetica')
const LOG = path.join(DIR, 'solve-log.jsonl')              // every attempt → metrics / the compounding curve
const MEM = path.join(DIR, 'verified-solutions.jsonl')     // verified solutions → retrieval corpus

export interface SolveRecord { ts: number; task: string; solved: boolean; attempts: number; escalated: boolean; model: string; usedMemory: boolean }
export interface VerifiedSolution { ts: number; task: string; files: { path: string; content: string }[]; verify: string; embedding?: number[] }

function readJsonl<T>(file: string): T[] {
  try { return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as T) } catch { return [] }
}
function appendJsonl(file: string, obj: unknown): void {
  try { fs.mkdirSync(DIR, { recursive: true }); fs.appendFileSync(file, JSON.stringify(obj) + '\n') } catch { /* best-effort */ }
}

export function recordSolve(rec: Omit<SolveRecord, 'ts'>): void {
  appendJsonl(LOG, { ts: Date.now(), ...rec })
}

export async function recordVerified(task: string, files: { path: string; content: string }[], verify: string): Promise<void> {
  let embedding: number[] | undefined
  try { embedding = (await embedBatchLocal([task]))?.[0] ?? undefined } catch { /* embedder cold */ }
  appendJsonl(MEM, { ts: Date.now(), task, files: files.slice(0, 12), verify, ...(embedding ? { embedding } : {}) })
}

function cosine(a: number[], b: number[]): number {
  let s = 0, na = 0, nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) { s += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]! }
  return s / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

/** The k most-similar proven solutions to `task` (cosine over the embedder; recency fallback). */
export async function retrieveSimilar(task: string, k = 2): Promise<VerifiedSolution[]> {
  const all = readJsonl<VerifiedSolution>(MEM)
  if (!all.length) return []
  let qemb: number[] | undefined
  try { qemb = (await embedBatchLocal([task]))?.[0] ?? undefined } catch { /* */ }
  if (!qemb) return all.slice(-k)
  return all.filter((s) => s.embedding)
    .map((s) => ({ s, score: cosine(qemb!, s.embedding!) }))
    .sort((a, b) => b.score - a.score)
    .filter((x) => x.score > 0.55)   // only genuinely similar
    .slice(0, k)
    .map((x) => x.s)
}

/** Render retrieved solutions as a compact few-shot block for the solve prompt. */
export function fewShot(solutions: VerifiedSolution[]): string {
  if (!solutions.length) return ''
  const blocks = solutions.map((s) => {
    const files = s.files.map((f) => `// ${f.path}\n${f.content}`).join('\n').slice(0, 1500)
    return `Task: ${s.task}\nVerified solution:\n${files}\nVerify: ${s.verify}`
  })
  return `Here are PROVEN solutions to similar tasks (they passed verification). Reuse their patterns where they fit:\n\n${blocks.join('\n\n---\n\n')}`
}

export interface QualityMetrics {
  total: number; solved: number; solveRate: number; avgAttempts: number; escalationRate: number; memoryUseRate: number
  series: { window: string; rate: number; avgAttempts: number; n: number }[]
}
/** Solve-rate over time — the compounding curve. Buckets the log into ~8 windows. */
export function qualityMetrics(): QualityMetrics {
  const recs = readJsonl<SolveRecord>(LOG)
  const total = recs.length
  if (!total) return { total: 0, solved: 0, solveRate: 0, avgAttempts: 0, escalationRate: 0, memoryUseRate: 0, series: [] }
  const solved = recs.filter((r) => r.solved).length
  const avgAttempts = recs.reduce((a, r) => a + r.attempts, 0) / total
  const escalationRate = recs.filter((r) => r.escalated).length / total
  const memoryUseRate = recs.filter((r) => r.usedMemory).length / total
  const N = Math.max(5, Math.ceil(total / 8))
  const series: QualityMetrics['series'] = []
  for (let i = 0; i < total; i += N) {
    const w = recs.slice(i, i + N)
    series.push({ window: `${i + 1}-${i + w.length}`, rate: w.filter((r) => r.solved).length / w.length, avgAttempts: w.reduce((a, r) => a + r.attempts, 0) / w.length, n: w.length })
  }
  return { total, solved, solveRate: solved / total, avgAttempts, escalationRate, memoryUseRate, series }
}
