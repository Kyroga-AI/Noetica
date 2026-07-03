/**
 * frontier-math-bench — the FRONTIER-tier math board (MATH / AIME analog of the
 * MMLU MCQ board in mmlu-brain-bench.ts). Frontier math is free-response: answers
 * are expressions (fractions, radicals, matrices), graded by sympy-equivalence
 * (scripts/math_grade.py), NOT letter-matching. This is where verified compute
 * has the most leverage — exact operator computation on problems that defeat
 * pattern-matching — so a reproduced delta here is the most defensible frontier
 * fact for the intelligence-superiority benchmark.
 *
 * Two arms (the honest like-for-like comparison, same model):
 *   baseline   — model solves directly, ends with \boxed{...}; parse + grade.
 *   opcompute  — model writes a Python program (may import the verified
 *                math_operators library + sympy) that prints ONLY the final
 *                answer; execute it (lib/exec-verify pattern), grade the output.
 *                This is the moat arm — same +8-10pp mechanism proven on MMLU-STEM.
 *
 * Emits: a scoreboard + per-question JSONL (both arms' correctness per item) so
 * scripts/board-analysis.py can run the exact-McNemar significance test.
 *
 * Bank format (FMATH_BANK): JSON array [{ id, problem, answer, level?, subject? }]
 * where `answer` is the ground-truth (a \boxed{}-free expression string). On a
 * board this points at the real MATH-500 test split; locally it can point at a
 * small fixture. NO hand-authored problems ship here — the dataset is the real
 * benchmark, fetched on the board (that is what makes the fact reproduced, not
 * cited).
 *
 * Run: FMATH_BANK=/path/math500.json FMATH_MODEL=qwen2.5:7b FMATH_ARMS=baseline,opcompute \
 *      FMATH_N=500 FMATH_SEED=1729 npx tsx scripts/frontier-math-bench.ts
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ensureOperatorImport, extractCode } from '../lib/exec-verify.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LIBDIR = path.join(__dirname, '..', 'lib')
const GRADE_PY = path.join(__dirname, 'math_grade.py')

const API_BASE = process.env['FMATH_API_BASE'] || process.env['OLLAMA_OPENAI'] || 'http://127.0.0.1:11434'
const MODEL = process.env['FMATH_MODEL'] || 'qwen2.5:7b'
const ARMS = (process.env['FMATH_ARMS'] || 'baseline,opcompute').split(',').map((s) => s.trim()).filter(Boolean)
const N = Number(process.env['FMATH_N'] || 0) // 0 = all
const SEED = Number(process.env['FMATH_SEED'] ?? 1729)
const MAXTOK = Number(process.env['FMATH_MAXTOK'] || 1024)
const TIMEOUT = Number(process.env['FMATH_TIMEOUT_MS'] || 120_000)
const SUBPROC_TIMEOUT = Number(process.env['FMATH_SUBPROC_TIMEOUT_MS'] || 60_000)
const CONC = Number(process.env['FMATH_CONC'] || 8)
const BANK = process.env['FMATH_BANK'] || path.join(os.homedir(), '.noetica', 'corpus', 'benchmarks', 'math500.json')

interface Problem { id: number | string; problem: string; answer: string; level?: string; subject?: string }
type Verdict = { id: number | string; arm: string; cand: string | null; match: boolean }

// deterministic RNG so a seed reproduces the sampled subset (matches board discipline)
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function ask(prompt: string, temperature = 0): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, stream: false, temperature, max_tokens: MAXTOK,
        messages: [
          { role: 'system', content: 'You are a careful mathematician. Show minimal work; give the exact final answer.' },
          { role: 'user', content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    const d = (await res.json()) as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> }
    const m = d.choices?.[0]?.message
    return (m?.content || m?.reasoning_content || '').trim()
  } catch {
    return ''
  }
}

// last \boxed{...} in a completion (balanced single level, the common MATH form)
function parseBoxed(text: string): string | null {
  const idx = text.lastIndexOf('\\boxed')
  if (idx < 0) {
    // fall back to a trailing "answer is X" / final line
    const line = text.trim().split('\n').filter(Boolean).pop() ?? ''
    const m = line.match(/(?:=|answer(?:\s+is)?:?)\s*(.+)$/i)
    return m ? m[1]!.trim() : (line || null)
  }
  const brace = text.indexOf('{', idx)
  if (brace < 0) return null
  let depth = 0
  for (let i = brace; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(brace + 1, i) }
  }
  return null
}

async function baselineArm(p: Problem): Promise<string | null> {
  const raw = await ask(`Solve the problem. End your response with the final answer in \\boxed{}.\n\nProblem: ${p.problem}`, 0)
  return parseBoxed(raw)
}

const OPERATOR_API = `You have a verified Python library 'math_operators' (import and CALL it, never reimplement) plus sympy. Write a tiny program that computes the answer and prints ONLY the final answer value on the last line (a number or a sympy expression via sympy.printing). Do not print anything else.`

async function opcomputeArm(p: Problem): Promise<string | null> {
  const raw = await ask(`${OPERATOR_API}\n\nProblem: ${p.problem}\n\nReturn ONLY a \`\`\`python code block.`, 0)
  const code = extractCode(raw) ?? ''
  if (!/print/.test(code)) return null
  const wrapped = `import sys\nsys.path.insert(0, ${JSON.stringify(LIBDIR)})\n${ensureOperatorImport(code)}`
  let out = ''
  const f = path.join(os.tmpdir(), `fm_${Date.now()}_${Math.random().toString(36).slice(2)}.py`)
  try {
    fs.writeFileSync(f, wrapped)
    out = execFileSync('python3', [f], { encoding: 'utf8', timeout: SUBPROC_TIMEOUT, maxBuffer: 4 * 1024 * 1024 })
  } catch (e) {
    out = (e as { stdout?: string | Buffer })?.stdout?.toString() ?? ''
  } finally {
    fs.rmSync(f, { force: true })
  }
  const last = out.trim().split('\n').filter(Boolean).pop() ?? ''
  return last || null
}

// one python call grades a whole arm (one sympy import) — mirrors autoformBatch discipline
function gradeBatch(items: Array<{ id: number | string; gold: string; cand: string | null }>): Map<string, boolean> {
  const res = new Map<string, boolean>()
  if (!items.length) return res
  const input = items.map((it) => JSON.stringify(it)).join('\n') + '\n'
  try {
    const out = execFileSync('python3', [GRADE_PY], { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: SUBPROC_TIMEOUT })
    for (const line of out.split('\n')) {
      if (!line.trim()) continue
      const r = JSON.parse(line) as { id: number | string; match: boolean }
      res.set(String(r.id), r.match)
    }
  } catch { /* grader failure → all ungraded (false) */ }
  return res
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const idx = i++
        if (idx >= items.length) return
        out[idx] = await fn(items[idx]!)
      }
    }),
  )
  return out
}

async function main() {
  if (!fs.existsSync(BANK)) {
    console.error(`# frontier-math-bench: bank not found at ${BANK}\n# point FMATH_BANK at a MATH-format JSON array [{id,problem,answer,...}] (the board fetches the real MATH-500 test split).`)
    process.exit(2)
  }
  let bank = JSON.parse(fs.readFileSync(BANK, 'utf8')) as Problem[]
  const rng = mulberry32(SEED)
  bank = bank.map((p, i) => ({ p, k: rng(), i })).sort((a, b) => a.k - b.k).map((x) => x.p) // seeded shuffle
  if (N > 0) bank = bank.slice(0, N)

  console.log(`# frontier-math-bench — model=${MODEL} | arms=[${ARMS.join(', ')}] | n=${bank.length} | seed=${SEED}`)
  const verdicts: Verdict[] = []
  const score: Record<string, { c: number; n: number }> = {}
  for (const arm of ARMS) score[arm] = { c: 0, n: 0 }

  for (const arm of ARMS) {
    const solve = arm === 'opcompute' ? opcomputeArm : baselineArm
    const cands = await mapLimit(bank, CONC, solve)
    const graded = gradeBatch(bank.map((p, i) => ({ id: p.id, gold: p.answer, cand: cands[i] ?? null })))
    bank.forEach((p, i) => {
      const ok = graded.get(String(p.id)) ?? false
      score[arm]!.n++; if (ok) score[arm]!.c++
      verdicts.push({ id: p.id, arm, cand: cands[i] ?? null, match: ok })
    })
    const s = score[arm]!
    console.log(`# ${arm.padEnd(10)} ${s.c}/${s.n} = ${(100 * s.c / Math.max(1, s.n)).toFixed(1)}%`)
  }

  // per-question JSONL for board-analysis.py (exact-McNemar on the two arms' discordant pairs)
  const outDir = process.env['FMATH_OUT'] || path.join(os.tmpdir())
  const jsonl = path.join(outDir, `frontier-math-verdicts-${SEED}.jsonl`)
  // board-analysis.py's contract: one row per question with <arm>_ok booleans + a subject, so
  // `board-analysis.py --compare opcompute baseline` runs the exact-McNemar test unchanged.
  const subjectById = new Map(bank.map((p) => [String(p.id), String(p.subject || p.level || 'all')]))
  const byId = new Map<string, Record<string, boolean | string>>()
  for (const v of verdicts) {
    const k = String(v.id)
    if (!byId.has(k)) byId.set(k, { subject: subjectById.get(k) || 'all' })
    byId.get(k)![`${v.arm}_ok`] = v.match
  }
  fs.writeFileSync(jsonl, [...byId.entries()].map(([id, arms]) => JSON.stringify({ id, ...arms })).join('\n') + '\n')
  console.log(`# per-question verdicts → ${jsonl}`)
  if (ARMS.includes('baseline') && ARMS.includes('opcompute')) {
    const delta = 100 * (score['opcompute']!.c - score['baseline']!.c) / Math.max(1, score['baseline']!.n)
    console.log(`# verified-compute delta: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp (run board-analysis.py on the JSONL for exact-McNemar p)`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
