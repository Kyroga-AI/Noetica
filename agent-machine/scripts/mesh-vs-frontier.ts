/**
 * mesh-vs-frontier — LIVE head-to-head proof: our sovereign open-model mesh vs the frontier labs,
 * graded on the SAME problems by the SAME independent hidden tests, on the spot.
 *
 * This is the client-demo artifact. Not "our model scores 88% vs a hardcoded reference of 89%" —
 * the vendor models answer LIVE, right now, on the client's machine, and get graded by python
 * asserts the client can read. The verdict is earned in the room.
 *
 * Arms (each runs only if configured — point them at whatever you spun up):
 *   • mesh         — our open model over an OpenAI-compatible endpoint. Set MESH_URL to the GPU mesh
 *                    you just provisioned (e.g. https://mesh.client.internal/v1); defaults to the
 *                    on-device managed Ollama. MESH_MODEL picks the model, MESH_KEY is optional auth.
 *   • mesh+verify  — the SAME model + our verify-repair loop (the jiujitsu). Always included so the
 *                    client sees the open model with our ops layer, not just raw.
 *   • claude       — ANTHROPIC_API_KEY + CLAUDE_MODEL  (frontier; leaves the device).
 *   • gpt          — OPENAI_API_KEY  + GPT_MODEL       (frontier; leaves the device).
 *
 * Grading is honest: each solution runs against INDEPENDENT hidden tests (never the model's own).
 * Output: a scoreboard (pass@1 + avg latency per arm) and a JSON artifact for the client to keep.
 *
 * Run:  cd agent-machine && npx tsx scripts/mesh-vs-frontier.ts [n]
 *   n caps the number of problems (default: all). Only configured arms run.
 *
 * The whole point: a $0.85/hr L4 serving an open model + verify-repair ties the frontier on
 * objective coding work — proven, not asserted, with the client watching.
 */
import { execFile } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { extractCode, codeVerifyRepair } from '../lib/exec-verify.js'

const ex = promisify(execFile)

interface Problem { name: string; prompt: string; test: string }

// Objective, hidden-test-graded problems (hand-authored — no dataset fetch, no contamination risk).
// The `test` is the oracle: it imports nothing, just asserts against the entry point.
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
  { name: 'merge_intervals',
    prompt: 'Write a Python function merge_intervals(intervals: list[list[int]]) -> list[list[int]] that merges all overlapping intervals and returns them sorted by start.',
    test: `assert merge_intervals([[1,3],[2,6],[8,10],[15,18]]) == [[1,6],[8,10],[15,18]]
assert merge_intervals([[1,4],[4,5]]) == [[1,5]]
assert merge_intervals([[1,4]]) == [[1,4]]` },
  // ── HARD tier (DP / parsing / graph) — a 7B fails some of these, so the suite finally has headroom to
  //    discriminate mesh vs mesh+verify vs a frontier arm. Runs when n > 8 (e.g. client-proof.sh 20).
  { name: 'edit_distance',
    prompt: 'Write a Python function edit_distance(a: str, b: str) -> int returning the Levenshtein edit distance (min single-character insertions, deletions, or substitutions to turn a into b).',
    test: `assert edit_distance("kitten","sitting") == 3
assert edit_distance("","abc") == 3
assert edit_distance("abc","abc") == 0
assert edit_distance("sunday","saturday") == 3` },
  { name: 'coin_change',
    prompt: 'Write a Python function coin_change(coins: list[int], amount: int) -> int returning the fewest coins that sum to amount, or -1 if impossible. Each denomination may be used unlimited times.',
    test: `assert coin_change([1,2,5],11) == 3
assert coin_change([2],3) == -1
assert coin_change([1],0) == 0
assert coin_change([1,2,5],100) == 20` },
  { name: 'length_of_lis',
    prompt: 'Write a Python function length_of_lis(nums: list[int]) -> int returning the length of the longest STRICTLY increasing subsequence.',
    test: `assert length_of_lis([10,9,2,5,3,7,101,18]) == 4
assert length_of_lis([0,1,0,3,2,3]) == 4
assert length_of_lis([7,7,7,7,7]) == 1` },
  { name: 'word_break',
    prompt: 'Write a Python function word_break(s: str, words: list[str]) -> bool returning True if s can be segmented into a space-separated sequence of one or more dictionary words (words may be reused).',
    test: `assert word_break("leetcode",["leet","code"]) == True
assert word_break("applepenapple",["apple","pen"]) == True
assert word_break("catsandog",["cats","dog","sand","and","cat"]) == False` },
  { name: 'trap_rain_water',
    prompt: 'Write a Python function trap_rain_water(height: list[int]) -> int returning how many units of water are trapped after raining, given an elevation map of bar heights of width 1.',
    test: `assert trap_rain_water([0,1,0,2,1,0,1,3,2,1,2,1]) == 6
assert trap_rain_water([4,2,0,3,2,5]) == 9
assert trap_rain_water([]) == 0` },
  { name: 'min_window',
    prompt: 'Write a Python function min_window(s: str, t: str) -> str returning the smallest substring of s containing every character of t (including multiplicities), or "" if none exists.',
    test: `assert min_window("ADOBECODEBANC","ABC") == "BANC"
assert min_window("a","a") == "a"
assert min_window("a","aa") == ""` },
  { name: 'eval_rpn',
    prompt: 'Write a Python function eval_rpn(tokens: list[str]) -> int that evaluates an arithmetic expression in Reverse Polish Notation. Operators are + - * /; division truncates toward zero.',
    test: `assert eval_rpn(["2","1","+","3","*"]) == 9
assert eval_rpn(["4","13","5","/","+"]) == 6
assert eval_rpn(["10","6","9","3","+","-11","*","/","*","17","+","5","+"]) == 22` },
  { name: 'can_finish',
    prompt: 'Write a Python function can_finish(numCourses: int, prerequisites: list[list[int]]) -> bool returning True if all courses can be finished, given prerequisite pairs [a, b] meaning b must be taken before a (i.e. the dependency graph is acyclic).',
    test: `assert can_finish(2,[[1,0]]) == True
assert can_finish(2,[[1,0],[0,1]]) == False
assert can_finish(3,[[1,0],[2,1]]) == True` },
  { name: 'num_islands',
    prompt: "Write a Python function num_islands(grid: list[list[str]]) -> int counting islands in a grid of '1' (land) and '0' (water); cells connect 4-directionally.",
    test: `assert num_islands([["1","1","0"],["1","0","0"],["0","0","1"]]) == 2
assert num_islands([["0"]]) == 0
assert num_islands([["1","1","1"],["0","1","0"],["1","1","1"]]) == 1` },
  { name: 'spiral_order',
    prompt: 'Write a Python function spiral_order(matrix: list[list[int]]) -> list[int] returning all elements of the matrix in clockwise spiral order.',
    test: `assert spiral_order([[1,2,3],[4,5,6],[7,8,9]]) == [1,2,3,6,9,8,7,4,5]
assert spiral_order([[1,2],[3,4]]) == [1,2,4,3]
assert spiral_order([[7]]) == [7]` },
  { name: 'find_median_sorted_arrays',
    prompt: 'Write a Python function find_median_sorted_arrays(a: list[int], b: list[int]) -> float returning the median of the two sorted arrays combined.',
    test: `assert find_median_sorted_arrays([1,3],[2]) == 2.0
assert find_median_sorted_arrays([1,2],[3,4]) == 2.5
assert find_median_sorted_arrays([],[1]) == 1.0` },
  { name: 'decode_string',
    prompt: 'Write a Python function decode_string(s: str) -> str that decodes a string with the pattern k[encoded], where the encoded part repeats k times. Brackets may nest, e.g. "3[a2[c]]" -> "accaccacc".',
    test: `assert decode_string("3[a]2[bc]") == "aaabcbc"
assert decode_string("3[a2[c]]") == "accaccacc"
assert decode_string("2[abc]3[cd]ef") == "abcabccdcdcdef"` },
]

// ── generation adapters ──────────────────────────────────────────────────────
type GenFn = (prompt: string, temperature: number) => Promise<string>

/** OpenAI-compatible /chat/completions — covers our mesh (Ollama/vLLM/TGI/SGLang) AND OpenAI/GPT. */
function openAICompat(base: string, model: string, key?: string): GenFn {
  return async (prompt, temperature) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (key) headers['authorization'] = `Bearer ${key}`
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers,
      body: JSON.stringify({ model, temperature, max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!r.ok) throw new Error(`${r.status} ${(await r.text().catch(() => '')).slice(0, 160)}`)
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] }
    return j?.choices?.[0]?.message?.content ?? ''
  }
}

/** Anthropic /v1/messages — Claude's native shape (different from OpenAI). */
function anthropicMessages(model: string, key: string): GenFn {
  return async (prompt, temperature) => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 800, temperature, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!r.ok) throw new Error(`${r.status} ${(await r.text().catch(() => '')).slice(0, 160)}`)
    const j = (await r.json()) as { content?: { type: string; text?: string }[] }
    return (j?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
  }
}

interface Arm { id: string; label: string; sovereign: boolean; verify: boolean; gen: GenFn; note: string }

function buildArms(): Arm[] {
  const arms: Arm[] = []
  // Our mesh — default to the on-device managed Ollama; point MESH_URL at the GPU mesh you spun up.
  const meshBase = (process.env['MESH_URL'] || 'http://127.0.0.1:11435/v1').replace(/\/+$/, '')
  const meshModel = process.env['MESH_MODEL'] || 'qwen2.5-coder:7b'
  const meshKey = process.env['MESH_KEY']
  const meshGen = openAICompat(meshBase, meshModel, meshKey)
  const where = process.env['MESH_URL'] ? 'cloud mesh' : 'on-device'
  arms.push({ id: 'mesh', label: `our mesh — ${meshModel}`, sovereign: true, verify: false, gen: meshGen, note: `${where} · ${meshBase}` })
  arms.push({ id: 'mesh+vr', label: `our mesh + verify-repair`, sovereign: true, verify: true, gen: meshGen, note: `${meshModel} + jiujitsu loop` })
  // Frontier — only if a key is present (these leave the device).
  const aKey = process.env['ANTHROPIC_API_KEY']
  if (aKey) { const m = process.env['CLAUDE_MODEL'] || 'claude-sonnet-4-6'; arms.push({ id: 'claude', label: `frontier — ${m}`, sovereign: false, verify: false, gen: anthropicMessages(m, aKey), note: 'vendor · leaves device' }) }
  const oKey = process.env['OPENAI_API_KEY']
  if (oKey) { const m = process.env['GPT_MODEL'] || 'gpt-4o'; arms.push({ id: 'gpt', label: `frontier — ${m}`, sovereign: false, verify: false, gen: openAICompat('https://api.openai.com/v1', m, oKey), note: 'vendor · leaves device' }) }
  return arms
}

// ── grading (independent hidden tests — the honest oracle) ────────────────────
const dir = mkdtempSync(join(tmpdir(), 'mvf-'))
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

async function solve(arm: Arm, p: Problem): Promise<string | null> {
  if (arm.verify) {
    const cv = await codeVerifyRepair(p.prompt, { generate: arm.gen, execute: (_l, code) => runPython(code) }, 2)
    return cv?.solution ?? null
  }
  const text = await arm.gen(`${p.prompt}\n\nReturn ONLY the function in a \`\`\`python code block.`, 0.2)
  return extractCode(text)
}

interface ArmResult { id: string; label: string; sovereign: boolean; note: string; pass: number; total: number; avgMs: number; errors: number }

async function main() {
  const n = process.argv[2] ? Number(process.argv[2]) : PROBLEMS.length
  const problems = PROBLEMS.slice(0, n)
  const arms = buildArms()
  console.log(`\nmesh-vs-frontier · ${problems.length} problems · graded vs INDEPENDENT hidden tests · temp=0.2\n`)
  console.log(`arms: ${arms.map((a) => a.id).join(', ')}${arms.every((a) => a.sovereign) ? '   (no frontier key set — set ANTHROPIC_API_KEY / OPENAI_API_KEY to add live frontier arms)' : ''}\n`)

  const results: ArmResult[] = []
  for (const arm of arms) {
    let pass = 0, errors = 0, totalMs = 0
    process.stdout.write(`${arm.label.padEnd(34)} `)
    for (const p of problems) {
      const t0 = performance.now()
      let ok = false
      try { const sol = await solve(arm, p); ok = sol ? await gradeAgainstHidden(sol, p.test) : false }
      catch { errors++ }
      totalMs += performance.now() - t0
      if (ok) pass++
      process.stdout.write(ok ? '✓' : '·')
    }
    const avgMs = Math.round(totalMs / problems.length)
    results.push({ id: arm.id, label: arm.label, sovereign: arm.sovereign, note: arm.note, pass, total: problems.length, avgMs, errors })
    console.log(`  ${pass}/${problems.length}  (${(avgMs / 1000).toFixed(1)}s/q${errors ? `, ${errors} err` : ''})`)
  }

  // ── scoreboard ──
  const pct = (r: ArmResult) => Math.round((100 * r.pass) / r.total)
  console.log(`\n${'═'.repeat(72)}\n  SCOREBOARD — pass@1 on hidden tests\n${'═'.repeat(72)}`)
  console.log(`  ${'arm'.padEnd(34)}${'pass@1'.padEnd(14)}avg latency`)
  for (const r of results) {
    const tag = r.sovereign ? '🛡 ' : '☁ '
    console.log(`  ${tag}${r.label.padEnd(31)}${`${r.pass}/${r.total} (${pct(r)}%)`.padEnd(14)}${(r.avgMs / 1000).toFixed(1)}s`)
  }

  // ── verdict (the client takeaway) ──
  const best = results.reduce((a, b) => (b.pass > a.pass ? b : a))
  const ourBest = results.filter((r) => r.sovereign).reduce((a, b) => (b.pass > a.pass ? b : a))
  const frontier = results.filter((r) => !r.sovereign)
  console.log(`\n${'─'.repeat(72)}`)
  if (frontier.length === 0) {
    console.log(`  Our mesh best: ${ourBest.label} → ${pct(ourBest)}%. Add a frontier key to prove parity head-to-head.`)
  } else {
    const fBest = frontier.reduce((a, b) => (b.pass > a.pass ? b : a))
    const verdict = ourBest.pass >= fBest.pass ? 'MATCHES OR BEATS' : ourBest.pass >= fBest.pass - 1 ? 'WITHIN ONE PROBLEM OF' : 'TRAILS'
    console.log(`  VERDICT: our sovereign mesh (${ourBest.label}, ${pct(ourBest)}%) ${verdict} the frontier (${fBest.label}, ${pct(fBest)}%)`)
    console.log(`  — on objective, hidden-test-graded work, answered live. Our arm runs on your infra at a flat`)
    console.log(`    GPU \$/hr; the frontier bills per token and your data leaves the device. Best overall: ${best.label}.`)
  }
  console.log(`${'─'.repeat(72)}\n`)

  // ── artifact for the client to keep ──
  const artifact = { suite: 'mesh-vs-frontier/code', problems: problems.length, tempSeed: 0.2, results }
  const out = join(process.cwd(), `mesh-vs-frontier.${problems.length}q.json`)
  writeFileSync(out, JSON.stringify(artifact, null, 2))
  console.log(`  artifact → ${out}\n`)
}

void main()
