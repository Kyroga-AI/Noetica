/**
 * swe-lite-eval — a bug-fix eval (closer to SWE-bench than HumanEval). Each task is a
 * piece of subtly BUGGY existing code + a task description + INDEPENDENT hidden tests.
 * The model must fix the bug so the hidden tests pass — the real coding-agent job
 * (edit existing code), not greenfield function-writing. Graded honestly against the
 * hidden oracle, baseline vs verify-repair.
 *
 * Run:  cd agent-machine && npx tsx scripts/swe-lite-eval.ts [model] [n]
 * Requires Ollama on :11434 + python3.
 */
import { execFile } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { extractCode, codeVerifyRepair } from '../lib/exec-verify.js'

const ex = promisify(execFile)
const MODEL = process.argv[2] || 'qwen2.5-coder:7b'
const OLLAMA = 'http://127.0.0.1:11434/api/chat'

interface Task { name: string; buggy: string; task: string; test: string }

const TASKS: Task[] = [
  { name: 'average',
    task: 'average(nums) should return the arithmetic mean as a float.',
    buggy: 'def average(nums):\n    return sum(nums) // len(nums)',   // integer division bug
    test: 'assert abs(average([1,2,4]) - 2.3333333) < 1e-4\nassert abs(average([2,2]) - 2.0) < 1e-9' },
  { name: 'fib',
    task: 'fib(n) should return the n-th Fibonacci number with fib(0)=0, fib(1)=1.',
    buggy: 'def fib(n):\n    if n <= 2:\n        return n\n    return fib(n-1) + fib(n-2)',   // wrong base case
    test: 'assert fib(0)==0 and fib(1)==1 and fib(2)==1\nassert fib(10)==55' },
  { name: 'dedupe_order',
    task: 'dedupe(xs) should remove duplicates while PRESERVING first-seen order.',
    buggy: 'def dedupe(xs):\n    return list(set(xs))',   // loses order
    test: 'assert dedupe([3,1,3,2,1]) == [3,1,2]\nassert dedupe([]) == []' },
  { name: 'is_anagram',
    task: 'is_anagram(a,b) should be case-insensitive and ignore spaces.',
    buggy: 'def is_anagram(a, b):\n    return sorted(a) == sorted(b)',   // ignores case + spaces
    test: 'assert is_anagram("Dormitory", "Dirty Room") == True\nassert is_anagram("abc", "abd") == False' },
  { name: 'second_largest',
    task: 'second_largest(nums) should return the second-largest DISTINCT value.',
    buggy: 'def second_largest(nums):\n    return sorted(nums)[-2]',   // breaks on duplicate max
    test: 'assert second_largest([5,5,3,1]) == 3\nassert second_largest([1,2,3]) == 2' },
  { name: 'running_total',
    task: 'running_total(xs) should return the list of cumulative sums.',
    buggy: 'def running_total(xs):\n    total = 0\n    out = []\n    for x in xs:\n        out.append(total)\n        total += x\n    return out',   // appends before adding (off-by-one)
    test: 'assert running_total([1,2,3]) == [1,3,6]\nassert running_total([]) == []' },
]

async function generate(prompt: string, temperature: number): Promise<string> {
  const r = await fetch(OLLAMA, { method: 'POST', body: JSON.stringify({
    model: MODEL, stream: false, options: { temperature, num_predict: 700 },
    messages: [{ role: 'user', content: prompt }] }) })
  return (await r.json() as { message?: { content?: string } })?.message?.content ?? ''
}

const dir = mkdtempSync(join(tmpdir(), 'swe-lite-'))
async function runPython(code: string): Promise<string> {
  const f = join(dir, `s${Math.floor(performance.now())}.py`)
  writeFileSync(f, code)
  try { const { stdout } = await ex('python3', [f], { timeout: 12_000 }); return stdout || 'OK' }
  catch (e: any) { return `ERR: ${(e.stderr || e.message || '').toString().split('\n').slice(-3).join(' ')}` }
}
async function gradeAgainstHidden(solution: string, test: string): Promise<boolean> {
  const out = await runPython(`${solution}\n\n${test}\nprint("HIDDEN_OK")`)
  return out.includes('HIDDEN_OK') && !/\b(Error|Traceback|assert)/i.test(out.replace('HIDDEN_OK', ''))
}

const fixPrompt = (t: Task) =>
  `This ${'`'}${t.name}${'`'} function has a bug:\n\n\`\`\`python\n${t.buggy}\n\`\`\`\n\n${t.task}\nFix the bug and return ONLY the corrected complete function in a \`\`\`python code block.`

async function main() {
  const n = process.argv[3] ? Number(process.argv[3]) : TASKS.length
  const tasks = TASKS.slice(0, n)
  console.log(`swe-lite (bug-fix) · model=${MODEL} · ${tasks.length} tasks · graded vs HIDDEN tests\n`)
  let basePass = 0, vrPass = 0
  for (const t of tasks) {
    const base = extractCode(await generate(fixPrompt(t), 0.2))
    const baseOk = base ? await gradeAgainstHidden(base, t.test) : false

    const cv = await codeVerifyRepair(`${t.task}\n\nStarting from this buggy code, return a corrected version:\n${t.buggy}`,
      { generate, execute: (_l, code) => runPython(code) }, 2)
    const vrOk = cv ? await gradeAgainstHidden(cv.solution, t.test) : false

    if (baseOk) basePass++; if (vrOk) vrPass++
    console.log(`${t.name.padEnd(18)} baseline ${baseOk ? '✓' : '✗'}   verify-repair ${vrOk ? '✓' : '✗'}`)
  }
  const pct = (x: number) => `${x}/${tasks.length} (${Math.round(100 * x / tasks.length)}%)`
  console.log(`\n=== bug-fix pass@1 (hidden tests) ===`)
  console.log(`baseline:      ${pct(basePass)}`)
  console.log(`verify-repair: ${pct(vrPass)}`)
}
void main()
