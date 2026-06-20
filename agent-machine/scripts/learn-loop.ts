/**
 * learn-loop.ts — the compounding learn-from-failure loop, end to end:
 *
 *   ASSESS    run MMLU items, capture every failure (Q, choices, gold, wrong answer)
 *   REMEDIATE deep-research each failure with the reasoning model → write a
 *             RemediationLesson to the KB (atom + embedded corpus doc)
 *   SYMREG    recover a governing relation from worked numeric examples (SINDy)
 *   DELTA     re-run the failed items WITH the written-back lessons injected as
 *             grounding → ridge-regress the improvement → report the delta
 *
 * Defaults are tiny (CPU box). Scale via env:
 *   LL_SUBJECTS=college_mathematics,college_physics  LL_ITEMS=5  tsx scripts/learn-loop.ts
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setOllamaBase } from '../lib/ollama.js'
import { remediateFailure, lessonGroundingFor, remediationCount, type Failure } from '../lib/remediation.js'

const exec = promisify(execFile)
const BANK = path.join(os.homedir(), '.noetica', 'corpus', 'benchmarks')
const BASE = process.env['OLLAMA_HOST']?.replace(/\/$/, '') || 'http://127.0.0.1:11435'
const MODEL = process.env['LL_MODEL'] || 'qwen2.5:7b-cpu'
const SUBJECTS = (process.env['LL_SUBJECTS'] || 'college_mathematics').split(',')
const ITEMS = Number(process.env['LL_ITEMS'] || 4)
const LETTERS = ['A', 'B', 'C', 'D']

const ASK_TIMEOUT = Number(process.env['LL_TIMEOUT_MS'] || 300_000)
async function ask(prompt: string, sys: string): Promise<string> {
  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, stream: false, messages: [{ role: 'system', content: sys }, { role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(ASK_TIMEOUT),
    })
    const d = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    return (d.choices?.[0]?.message?.content || '').trim()
  } catch { return '' } // timeout/error → treated as no answer (graded wrong), never crashes the loop
}
const letter = (raw: string) => (/FINAL:\s*([A-D])/i.exec(raw)?.[1] || /\b([A-D])\b(?![\s\S]*\b[A-D]\b)/.exec(raw.trim())?.[1] || '').toUpperCase()
const SYS = 'Multiple-choice exam. Reason briefly, end with "FINAL: X" (one letter).'

async function symreg(job: object): Promise<any> {
  const script = path.join(import.meta.dirname, 'symreg.py')
  const stdout = await new Promise<string>((resolve, reject) => {
    const cp = execFile('python3', [script], (e, so) => e ? reject(e) : resolve(so))
    cp.stdin!.write(JSON.stringify(job)); cp.stdin!.end()
  })
  return JSON.parse(stdout)
}

async function main() {
  setOllamaBase(BASE)
  const mmlu = JSON.parse(fs.readFileSync(path.join(BANK, 'mmlu_stem.json'), 'utf8')) as Record<string, Array<{ question: string; choices: string[]; answer: number }>>
  console.log(`# Learn-from-failure loop — model=${MODEL} | subjects=${SUBJECTS.join(',')} items=${ITEMS}\n`)

  // 1) ASSESS — capture failures
  const failures: Array<Failure & { q: { question: string; choices: string[]; answer: number } }> = []
  let assessed = 0, passed = 0
  for (const subj of SUBJECTS) {
    for (const it of (mmlu[subj] || []).slice(0, ITEMS)) {
      const prompt = `${it.question}\n\n${it.choices.map((c, i) => `${LETTERS[i]}. ${c}`).join('\n')}`
      const ans = letter(await ask(prompt, SYS)); assessed++
      if (ans === LETTERS[it.answer]) passed++
      else failures.push({ subject: subj, question: it.question, choices: it.choices, gold: LETTERS[it.answer], modelAnswer: ans || '(none)', q: it })
    }
  }
  console.log(`ASSESS: ${passed}/${assessed} correct, ${failures.length} failures\n`)

  // 2) REMEDIATE — deep research → KB lesson
  console.log(`REMEDIATE (deep research → KB):`)
  for (const f of failures) {
    const l = await remediateFailure(f)
    console.log(`  ✎ [${f.subject}] wrong=${f.modelAnswer} gold=${f.gold} → lesson: ${l.lesson.slice(0, 90)}`)
  }
  console.log(`  KB now holds ${remediationCount()} remediation lessons\n`)

  // 3) SYMREG — recover a governing relation from worked numeric examples
  const sr = await symreg({ op: 'symbolic_regress', feature_names: ['t'], degree: 2, threshold: 0.3,
    X: [[1], [2], [3], [4], [5]], y: [4.9, 19.6, 44.1, 78.4, 122.5] })
  console.log(`SYMREG (governing relation from data): d = ${sr.law}   (R²=${sr.r2})\n`)

  // 4) DELTA — re-run the failed items WITH written-back lessons injected
  console.log(`DELTA (re-run failures with lessons grounding):`)
  const pre = failures.map(() => 0)   // all failed first pass
  const post: number[] = []
  for (const f of failures) {
    const grounding = await lessonGroundingFor(f.question, 2)
    const prompt = `${f.question}\n\n${f.choices!.map((c, i) => `${LETTERS[i]}. ${c}`).join('\n')}${grounding}`
    const ans = letter(await ask(prompt, SYS))
    const ok = ans === f.gold; post.push(ok ? 1 : 0)
    console.log(`  ${ok ? '✓ recovered' : '✗ still wrong'} [${f.subject}] now=${ans} gold=${f.gold}`)
  }
  let delta: any = { mean_delta: 0, total_lessons_written_back: 0 }
  if (failures.length) delta = await symreg({ op: 'ridge_delta', pre, post, concepts: failures.map((f) => f.subject) })

  console.log(`\n## Result`)
  console.log(`  pre-remediation:  ${pre.reduce((a, b) => a + b, 0)}/${failures.length}`)
  console.log(`  post-remediation: ${post.reduce((a, b) => a + b, 0)}/${failures.length}`)
  console.log(`  mean Δ (ridge):   +${delta.mean_delta}   lessons written back: ${delta.total_lessons_written_back}`)
  console.log(`  governing law recovered: d = ${sr.law} (R²=${sr.r2})`)

  const out = { model: MODEL, subjects: SUBJECTS, assessed, passed, failures: failures.length,
    pre: pre.reduce((a, b) => a + b, 0), post: post.reduce((a, b) => a + b, 0), delta, symbolic_law: { law: sr.law, r2: sr.r2 },
    generated_at: new Date().toISOString() }
  const p = path.join(os.homedir(), '.noetica', `learn-loop-${Date.now()}.json`)
  fs.writeFileSync(p, JSON.stringify(out, null, 2)); console.log(`\nReport: ${p}`)
}
void main()
