/**
 * code-eval — functional-correctness coding eval (HumanEval-style), to quantify where
 * the local mesh trails frontier coding agents AND whether the verify-repair loop closes
 * the gap. Each problem is graded against INDEPENDENT HIDDEN tests (the oracle) — never
 * the model's own self-generated tests — so the score is honest.
 *
 * Two arms per problem:
 *   • baseline      — one generation, no verification (what a raw 7B ships).
 *   • verify-repair — codeVerifyRepair() from lib/exec-verify (generate→run own tests→repair).
 * Both solutions are then run against the hidden test. Reports pass@1 for each arm.
 *
 * Run:  cd agent-machine && npx tsx scripts/code-eval.ts [model] [n]
 *   model defaults to qwen2.5-coder:7b ; n caps the number of problems.
 * Requires: Ollama on :11434 with the model, and python3 on PATH.
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

interface Problem { name: string; prompt: string; test: string }

// HumanEval-style problems (hand-authored to avoid dataset fetch). The `test` is the
// hidden oracle: it imports nothing, just asserts against the entry point.
const PROBLEMS: Problem[] = [
  { name: 'has_close_elements',
    prompt: 'Write a Python function has_close_elements(numbers: list[float], threshold: float) -> bool that returns True if any two numbers in the list are closer to each other than the given threshold.',
    test: `assert has_close_elements([1.0, 2.0, 3.0], 0.5) == False
assert has_close_elements([1.0, 2.8, 3.0, 4.0, 5.0, 2.0], 0.3) == True
assert has_close_elements([1.0, 2.0], 1.5) == True` },
  { name: 'is_palindrome',
    prompt: 'Write a Python function is_palindrome(s: str) -> bool that returns True if s is a palindrome, ignoring case, spaces, and punctuation.',
    test: `assert is_palindrome("A man, a plan, a canal: Panama") == True
assert is_palindrome("race a car") == False
assert is_palindrome("") == True` },
  { name: 'fib',
    prompt: 'Write a Python function fib(n: int) -> int that returns the n-th Fibonacci number, with fib(0)=0 and fib(1)=1.',
    test: `assert fib(0) == 0
assert fib(1) == 1
assert fib(10) == 55
assert fib(20) == 6765` },
  { name: 'two_sum',
    prompt: 'Write a Python function two_sum(nums: list[int], target: int) -> list[int] that returns the indices of the two numbers that add up to target. Assume exactly one solution.',
    test: `assert sorted(two_sum([2,7,11,15], 9)) == [0,1]
assert sorted(two_sum([3,2,4], 6)) == [1,2]
assert sorted(two_sum([3,3], 6)) == [0,1]` },
  { name: 'roman_to_int',
    prompt: 'Write a Python function roman_to_int(s: str) -> int that converts a Roman numeral string to an integer.',
    test: `assert roman_to_int("III") == 3
assert roman_to_int("IV") == 4
assert roman_to_int("IX") == 9
assert roman_to_int("LVIII") == 58
assert roman_to_int("MCMXCIV") == 1994` },
  { name: 'flatten',
    prompt: 'Write a Python function flatten(lst: list) -> list that flattens an arbitrarily nested list of integers into a single flat list, preserving order.',
    test: `assert flatten([1, [2, [3, 4], 5]]) == [1,2,3,4,5]
assert flatten([]) == []
assert flatten([[1],[2],[3]]) == [1,2,3]` },
  { name: 'longest_common_prefix',
    prompt: 'Write a Python function longest_common_prefix(strs: list[str]) -> str that returns the longest common prefix among a list of strings, or "" if none.',
    test: `assert longest_common_prefix(["flower","flow","flight"]) == "fl"
assert longest_common_prefix(["dog","racecar","car"]) == ""
assert longest_common_prefix(["a"]) == "a"` },
  { name: 'valid_parentheses',
    prompt: 'Write a Python function valid_parentheses(s: str) -> bool that returns True if every open bracket among ()[]{} is closed by the same type in the correct order.',
    test: `assert valid_parentheses("()[]{}") == True
assert valid_parentheses("(]") == False
assert valid_parentheses("([)]") == False
assert valid_parentheses("{[]}") == True` },
]

async function generate(prompt: string, temperature: number): Promise<string> {
  const r = await fetch(OLLAMA, { method: 'POST', body: JSON.stringify({
    model: MODEL, stream: false, options: { temperature, num_predict: 700 },
    messages: [{ role: 'user', content: prompt }] }) })
  return (await r.json() as { message?: { content?: string } })?.message?.content ?? ''
}

const dir = mkdtempSync(join(tmpdir(), 'code-eval-'))
async function runPython(code: string): Promise<string> {
  const f = join(dir, `s${Math.floor(performance.now())}.py`)
  writeFileSync(f, code)
  try { const { stdout } = await ex('python3', [f], { timeout: 12_000 }); return stdout || 'OK' }
  catch (e: any) { return `ERR: ${(e.stderr || e.message || '').toString().split('\n').slice(-3).join(' ')}` }
}

/** Grade a solution against the hidden oracle test. */
async function gradeAgainstHidden(solution: string, test: string): Promise<boolean> {
  const out = await runPython(`${solution}\n\n${test}\nprint("HIDDEN_OK")`)
  return out.includes('HIDDEN_OK') && !/\b(Error|Traceback|assert)/i.test(out.replace('HIDDEN_OK', ''))
}

async function baselineSolution(p: Problem): Promise<string | null> {
  const text = await generate(`${p.prompt}\n\nReturn ONLY the function in a \`\`\`python code block.`, 0.2)
  return extractCode(text)
}

async function main() {
  const n = process.argv[3] ? Number(process.argv[3]) : PROBLEMS.length
  const problems = PROBLEMS.slice(0, n)
  console.log(`code-eval · model=${MODEL} · ${problems.length} problems · graded vs HIDDEN tests\n`)
  let basePass = 0, vrPass = 0
  for (const p of problems) {
    const base = await baselineSolution(p)
    const baseOk = base ? await gradeAgainstHidden(base, p.test) : false

    const cv = await codeVerifyRepair(p.prompt, { generate, execute: (_l, code) => runPython(code) }, 2)
    const vrOk = cv ? await gradeAgainstHidden(cv.solution, p.test) : false

    if (baseOk) basePass++; if (vrOk) vrPass++
    console.log(`${p.name.padEnd(24)} baseline ${baseOk ? '✓' : '✗'}   verify-repair ${vrOk ? '✓' : '✗'}${cv && !cv.passed ? ' (self-tests failed)' : ''}`)
  }
  const pct = (x: number) => `${x}/${problems.length} (${Math.round(100 * x / problems.length)}%)`
  console.log(`\n=== pass@1 (hidden tests) ===`)
  console.log(`baseline (single shot):     ${pct(basePass)}`)
  console.log(`verify-repair (gen→test→repair): ${pct(vrPass)}`)
  console.log(`\nReference: published HumanEval — Claude/GPT frontier ~90%+, qwen2.5-coder-7b ~85% (raw).`)
}

void main()
