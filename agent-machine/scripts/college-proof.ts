/**
 * college-proof.ts — a real, auto-graded competency assessment across a college
 * math + science core, run against the LOCAL model stack. Produces a scored
 * transcript (the "diploma") proving the agent's knowledge, not a vibe check.
 *
 * Each item has a verifiable gold answer and a grading method (numeric tolerance,
 * multiple-choice letter, or normalized string). The model is asked to end with
 * `FINAL: <answer>` so the grader can extract deterministically.
 *
 * Usage:
 *   tsx scripts/college-proof.ts                  # full bank
 *   COLLEGE_MODEL=deepseek-r1:8b-cpu tsx ...       # pick the worker model
 *   COLLEGE_LIMIT=2 tsx scripts/college-proof.ts   # N items per domain (smoke)
 */
const BASE = process.env['OLLAMA_HOST']?.replace(/\/$/, '') || 'http://127.0.0.1:11435'
const MODEL = process.env['COLLEGE_MODEL'] || 'qwen2.5:7b-cpu'
const PER_ITEM_TIMEOUT = Number(process.env['COLLEGE_TIMEOUT_MS'] || 150_000)
const LIMIT = Number(process.env['COLLEGE_LIMIT'] || 0) // 0 = all

type Grade = { kind: 'numeric'; gold: number; tol: number } | { kind: 'mcq'; gold: string } | { kind: 'string'; gold: string }
interface Item { id: string; domain: string; q: string; grade: Grade }

const ITEMS: Item[] = [
  // ── Calculus ──
  { id: 'calc-1', domain: 'Calculus', q: 'What is the derivative of f(x)=x^3 evaluated at x=2?', grade: { kind: 'numeric', gold: 12, tol: 0.01 } },
  { id: 'calc-2', domain: 'Calculus', q: 'Evaluate the definite integral of x^2 from 0 to 1.', grade: { kind: 'numeric', gold: 0.3333, tol: 0.01 } },
  // ── Linear Algebra ──
  { id: 'la-1', domain: 'Linear Algebra', q: 'What is the determinant of the matrix [[2,1],[1,3]]?', grade: { kind: 'numeric', gold: 5, tol: 0.01 } },
  { id: 'la-2', domain: 'Linear Algebra', q: 'The matrix [[2,0],[0,3]] is diagonal. What is its largest eigenvalue?', grade: { kind: 'numeric', gold: 3, tol: 0.01 } },
  // ── Probability ──
  { id: 'prob-1', domain: 'Probability', q: 'Two fair six-sided dice are rolled. What is the probability the sum equals 7? Give a decimal.', grade: { kind: 'numeric', gold: 0.1667, tol: 0.01 } },
  { id: 'prob-2', domain: 'Probability', q: 'A fair coin is flipped 3 times. What is the probability of exactly 2 heads? Give a decimal.', grade: { kind: 'numeric', gold: 0.375, tol: 0.01 } },
  // ── Physics ──
  { id: 'phys-1', domain: 'Physics', q: 'An object is dropped from rest. Using g=9.8 m/s^2, what is its speed (m/s) after 3 seconds?', grade: { kind: 'numeric', gold: 29.4, tol: 0.2 } },
  { id: 'phys-2', domain: 'Physics', q: 'A net force accelerates a 2 kg mass at 5 m/s^2. What is the force in newtons?', grade: { kind: 'numeric', gold: 10, tol: 0.01 } },
  // ── Chemistry ──
  { id: 'chem-1', domain: 'Chemistry', q: 'What is the approximate molar mass of water (H2O) in g/mol?', grade: { kind: 'numeric', gold: 18, tol: 0.5 } },
  { id: 'chem-2', domain: 'Chemistry', q: 'How many moles are in 36 grams of water (molar mass 18 g/mol)?', grade: { kind: 'numeric', gold: 2, tol: 0.01 } },
  // ── Biology ──
  { id: 'bio-1', domain: 'Biology', q: 'How many pairs of chromosomes are in a typical human somatic cell?', grade: { kind: 'numeric', gold: 23, tol: 0.01 } },
  { id: 'bio-2', domain: 'Biology', q: 'Which organelle is known as the powerhouse of the cell? Answer with the single word.', grade: { kind: 'string', gold: 'mitochondria' } },
]

function extractFinal(text: string): string {
  const m = /FINAL:\s*([^\n]+)/i.exec(text)
  return (m ? m[1]! : text.split('\n').filter(Boolean).pop() || '').trim()
}
function firstNumber(s: string): number | null {
  // Normalize LaTeX so model answers like \(\frac{1}{3}\) parse correctly.
  const t = s
    .replace(/\\d?frac\s*\{\s*(-?\d+(?:\.\d+)?)\s*\}\s*\{\s*(-?\d+(?:\.\d+)?)\s*\}/g, '$1/$2')
    .replace(/[()$\\]/g, ' ')
    .replace(/,/g, '')
  const m = t.match(/-?\d+(?:\.\d+)?\s*\/\s*-?\d+(?:\.\d+)?|-?\d+(?:\.\d+)?/)
  if (!m) return null
  const tok = m[0].replace(/\s+/g, '')
  if (tok.includes('/')) { const [a, b] = tok.split('/').map(Number); return b ? a! / b! : null }
  return Number(tok)
}
function gradeAnswer(item: Item, raw: string): boolean {
  const ans = extractFinal(raw)
  if (item.grade.kind === 'numeric') { const n = firstNumber(ans); return n != null && Math.abs(n - item.grade.gold) <= item.grade.tol }
  if (item.grade.kind === 'mcq') return ans.toUpperCase().startsWith(item.grade.gold.toUpperCase())
  // Stem-aware string match: tolerates singular/plural & morphology
  // (e.g. "mitochondrion" vs "mitochondria").
  const a = ans.toLowerCase().replace(/[^a-z]/g, '')
  const g = item.grade.gold.toLowerCase().replace(/[^a-z]/g, '')
  if (a.includes(g) || g.includes(a)) return true
  let p = 0; while (p < a.length && p < g.length && a[p] === g[p]) p++
  return p >= 5 && p >= Math.min(a.length, g.length) - 3
}

async function ask(q: string): Promise<string> {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, stream: false,
      messages: [
        { role: 'system', content: 'You are taking a college exam. Solve the problem. Show brief work, then end with a line formatted exactly as "FINAL: <answer>" containing only the final answer.' },
        { role: 'user', content: q },
      ],
    }),
    signal: AbortSignal.timeout(PER_ITEM_TIMEOUT),
  })
  const d = await res.json() as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> }
  const m = d.choices?.[0]?.message
  return (m?.content || m?.reasoning_content || '').trim()
}

async function main() {
  const byDomain = new Map<string, Item[]>()
  for (const it of ITEMS) { if (!byDomain.has(it.domain)) byDomain.set(it.domain, []); byDomain.get(it.domain)!.push(it) }
  const selected = LIMIT > 0 ? [...byDomain.values()].flatMap((v) => v.slice(0, LIMIT)) : ITEMS

  console.log(`# College Math/Science Proof — model=${MODEL} (${selected.length} items)\n`)
  const results: Array<{ id: string; domain: string; correct: boolean; answer: string; ms: number }> = []
  for (const it of selected) {
    const t0 = Date.now()
    let raw = '', correct = false
    try { raw = await ask(it.q); correct = gradeAnswer(it, raw) } catch (e) { raw = `ERROR: ${e instanceof Error ? e.message : e}` }
    const ms = Date.now() - t0
    results.push({ id: it.id, domain: it.domain, correct, answer: extractFinal(raw), ms })
    console.log(`${correct ? '✓' : '✗'} [${it.domain}] ${it.id}  →  "${extractFinal(raw).slice(0, 40)}"  (${(ms / 1000).toFixed(1)}s)`)
  }

  // Transcript
  const domains = [...new Set(selected.map((i) => i.domain))]
  console.log(`\n## Transcript`)
  const transcript: Record<string, { correct: number; total: number; pct: number }> = {}
  for (const d of domains) {
    const rs = results.filter((r) => r.domain === d)
    const c = rs.filter((r) => r.correct).length
    transcript[d] = { correct: c, total: rs.length, pct: Math.round((c / rs.length) * 100) }
    console.log(`  ${d.padEnd(16)} ${c}/${rs.length}  (${transcript[d].pct}%)`)
  }
  const total = results.length, correct = results.filter((r) => r.correct).length
  const overall = Math.round((correct / total) * 100)
  console.log(`  ${'OVERALL'.padEnd(16)} ${correct}/${total}  (${overall}%)`)

  const out = { model: MODEL, generated_at: new Date().toISOString(), overall_pct: overall, total, correct, by_domain: transcript, results }
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path')
  const p = path.join(os.homedir(), '.noetica', `college-transcript-${Date.now()}.json`)
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(out, null, 2)); console.log(`\nTranscript written: ${p}`) } catch { /* ignore */ }
}
void main()
